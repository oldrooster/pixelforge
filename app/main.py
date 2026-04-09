import base64
import json
import os
from io import BytesIO
from pathlib import Path
from threading import Lock

from flask import Flask, jsonify, request, send_file, send_from_directory
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2 import service_account
import requests

app = Flask(__name__, static_folder="static", static_url_path="/static")

_rembg_lock = Lock()
_rembg_remove = None
_rembg_session = None

_vertex_lock = Lock()
_vertex_credentials = None
_vertex_project_id = None

VERTEX_LOCATION = os.getenv("VERTEX_LOCATION", "us-central1")
VERTEX_GENERATE_MODEL = os.getenv("VERTEX_GENERATE_MODEL", "imagen-3.0-generate-002")
VERTEX_INPAINT_MODEL = os.getenv("VERTEX_INPAINT_MODEL", "imagen-3.0-capability-001")
VERTEX_CREDENTIALS_PATH = Path(
    os.getenv("VERTEX_CREDENTIALS_PATH", str(Path(__file__).resolve().parents[1] / "vertex.json"))
)


def _load_vertex_credentials():
    global _vertex_credentials, _vertex_project_id

    if _vertex_credentials is not None and _vertex_project_id:
        return

    if not VERTEX_CREDENTIALS_PATH.exists():
        raise FileNotFoundError(f"Vertex credentials file not found: {VERTEX_CREDENTIALS_PATH}")

    with VERTEX_CREDENTIALS_PATH.open("r", encoding="utf-8") as f:
        info = json.load(f)

    project_id = info.get("project_id")
    if not project_id:
        raise ValueError("project_id missing in vertex credentials JSON")

    _vertex_credentials = service_account.Credentials.from_service_account_info(
        info,
        scopes=["https://www.googleapis.com/auth/cloud-platform"],
    )
    _vertex_project_id = project_id


def _get_vertex_access_token_and_project():
    with _vertex_lock:
        _load_vertex_credentials()

        if not _vertex_credentials.valid or _vertex_credentials.expired:
            _vertex_credentials.refresh(GoogleAuthRequest())

        return _vertex_credentials.token, _vertex_project_id


def _vertex_predict(model_name, instances, parameters):
    token, project_id = _get_vertex_access_token_and_project()

    endpoint = (
        f"https://{VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/{project_id}/"
        f"locations/{VERTEX_LOCATION}/publishers/google/models/{model_name}:predict"
    )

    response = requests.post(
        endpoint,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={
            "instances": instances,
            "parameters": parameters,
        },
        timeout=300,
    )

    if not response.ok:
        raise RuntimeError(
            f"Vertex predict failed ({response.status_code}): {response.text[:600]}"
        )

    return response.json()


def _extract_prediction_image_bytes(prediction_response):
    predictions = prediction_response.get("predictions") or []
    if not predictions:
        raise ValueError("No predictions returned by Vertex")

    candidate = predictions[0]
    if not isinstance(candidate, dict):
        raise ValueError("Unexpected prediction response format")

    direct = candidate.get("bytesBase64Encoded")
    if direct:
        return base64.b64decode(direct)

    image_obj = candidate.get("image")
    if isinstance(image_obj, dict) and image_obj.get("bytesBase64Encoded"):
        return base64.b64decode(image_obj["bytesBase64Encoded"])

    raise ValueError(f"Could not find image bytes in prediction response: {candidate}")


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.post("/api/remove-background")
def remove_background():
    global _rembg_remove, _rembg_session

    try:
        if _rembg_remove is None or _rembg_session is None:
            with _rembg_lock:
                if _rembg_remove is None or _rembg_session is None:
                    from rembg import new_session, remove

                    _rembg_remove = remove
                    _rembg_session = new_session("u2net")
    except Exception as exc:
        return jsonify({"error": f"rembg backend unavailable: {exc}"}), 503

    file = request.files.get("image")
    if file is None:
        return jsonify({"error": "Missing image file"}), 400

    data = file.read()
    if not data:
        return jsonify({"error": "Empty image file"}), 400

    try:
        output = _rembg_remove(data, session=_rembg_session)
    except Exception as exc:
        return jsonify({"error": f"AI background removal failed: {exc}"}), 500

    return send_file(
        BytesIO(output),
        mimetype="image/png",
        as_attachment=False,
        download_name="background_removed.png",
    )


@app.post("/api/vertex/generate")
def vertex_generate_image():
    payload = request.get_json(silent=True) or {}
    prompt = (payload.get("prompt") or "").strip()
    if not prompt:
        return jsonify({"error": "Prompt is required"}), 400

    try:
        prediction = _vertex_predict(
            VERTEX_GENERATE_MODEL,
            instances=[{"prompt": prompt}],
            parameters={
                "sampleCount": 1,
                "outputOptions": {"mimeType": "image/png"},
            },
        )
        image_bytes = _extract_prediction_image_bytes(prediction)
    except Exception as exc:
        return jsonify({"error": f"Vertex generate failed: {exc}"}), 500

    return send_file(
        BytesIO(image_bytes),
        mimetype="image/png",
        as_attachment=False,
        download_name="vertex_generated.png",
    )


@app.post("/api/vertex/inpaint")
def vertex_inpaint_image():
    prompt = (request.form.get("prompt") or "").strip()
    if not prompt:
        return jsonify({"error": "Prompt is required"}), 400

    image_file = request.files.get("image")
    mask_file = request.files.get("mask")
    if image_file is None or mask_file is None:
        return jsonify({"error": "Both image and mask files are required"}), 400

    image_bytes = image_file.read()
    mask_bytes = mask_file.read()
    if not image_bytes or not mask_bytes:
        return jsonify({"error": "Empty image or mask file"}), 400

    image_b64 = base64.b64encode(image_bytes).decode("utf-8")
    mask_b64 = base64.b64encode(mask_bytes).decode("utf-8")
    image_obj = {"mimeType": "image/png", "bytesBase64Encoded": image_b64}
    image_raw = {"bytesBase64Encoded": image_b64}
    mask_obj = {"mimeType": "image/png", "bytesBase64Encoded": mask_b64}
    mask_raw = {"bytesBase64Encoded": mask_b64}

    # Vertex image editing payload shape can vary across model versions.
    # Try a compatibility matrix of context and mask field variants.
    context_variants = [
        {"context_image": [{"image": image_obj}]},
        {"context_image": [{"image": image_raw}]},
        {"context_image": [image_obj]},
        {"context_image": {"image": image_obj}},
        {"contextImages": [{"image": image_obj}]},
        {"context_images": [{"image": image_obj}]},
    ]

    mask_variants = [
        {"mask": {"image": mask_obj}},
        {"mask": {"image": mask_raw}},
        {"mask": mask_obj},
        {"editMask": {"image": mask_obj}},
    ]

    candidate_instances = []
    for context_fields in context_variants:
        for mask_fields in mask_variants:
            base = {
                "prompt": prompt,
                "image": image_obj,
            }
            base.update(context_fields)
            base.update(mask_fields)
            candidate_instances.append(base)

    parameter_variants = [
        {
            "sampleCount": 1,
            "outputOptions": {"mimeType": "image/png"},
        },
        {
            "sampleCount": 1,
            "outputOptions": {"mimeType": "image/png"},
            "editConfig": {"editMode": "inpainting-insert"},
        },
        {
            "sampleCount": 1,
            "outputOptions": {"mimeType": "image/png"},
            "mode": "edit",
        },
    ]

    error_messages = []
    output_bytes = None

    for instance in candidate_instances:
        for params in parameter_variants:
            try:
                prediction = _vertex_predict(
                    VERTEX_INPAINT_MODEL,
                    instances=[instance],
                    parameters=params,
                )
                output_bytes = _extract_prediction_image_bytes(prediction)
                break
            except Exception as exc:
                message = str(exc)
                if message not in error_messages:
                    error_messages.append(message)
        if output_bytes is not None:
            break

    if output_bytes is None:
        summary = error_messages[-1] if error_messages else "Unknown Vertex inpainting failure"
        return jsonify({"error": f"Vertex inpainting failed: {summary}"}), 500

    return send_file(
        BytesIO(output_bytes),
        mimetype="image/png",
        as_attachment=False,
        download_name="vertex_inpainted.png",
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
