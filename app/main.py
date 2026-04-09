import base64
import json
import os
import struct
import zlib
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
VERTEX_GENERATE_MODEL = os.getenv("VERTEX_GENERATE_MODEL", "imagen-4.0-generate-001")
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


def _vertex_predict(model_name, instances, parameters, timeout=300):
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
        timeout=timeout,
    )

    if not response.ok:
        raise RuntimeError(
            f"Vertex predict failed ({response.status_code}): {response.text[:600]}"
        )

    return response.json()


def _make_white_mask_b64(image_bytes):
    """Return a base64-encoded full-white PNG with the same dimensions as image_bytes."""
    try:
        w = struct.unpack(">I", image_bytes[16:20])[0]
        h = struct.unpack(">I", image_bytes[20:24])[0]
    except Exception:
        w = h = 512

    row = b"\x00" + b"\xff" * w * 3
    raw = row * h

    def _chunk(tag, data):
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", zlib.compress(raw))
        + _chunk(b"IEND", b"")
    )
    return base64.b64encode(png).decode("utf-8")


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


def _extract_all_prediction_images_b64(prediction_response):
    predictions = prediction_response.get("predictions") or []
    if not predictions:
        raise ValueError("No predictions returned by Vertex")

    results = []
    for candidate in predictions:
        if not isinstance(candidate, dict):
            continue
        direct = candidate.get("bytesBase64Encoded")
        if direct:
            results.append(direct)
            continue
        image_obj = candidate.get("image")
        if isinstance(image_obj, dict) and image_obj.get("bytesBase64Encoded"):
            results.append(image_obj["bytesBase64Encoded"])

    if not results:
        raise ValueError("Could not find image bytes in any prediction")
    return results


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
                "sampleCount": 4,
                "outputOptions": {"mimeType": "image/png"},
            },
        )
        raw_predictions = prediction.get("predictions") or []
        print(f"[vertex/generate] requested 4, got {len(raw_predictions)} predictions back", flush=True)
        images_b64 = _extract_all_prediction_images_b64(prediction)
        print(f"[vertex/generate] extracted {len(images_b64)} images", flush=True)
    except Exception as exc:
        return jsonify({"error": f"Vertex generate failed: {exc}"}), 500

    return jsonify({"images": images_b64})


@app.post("/api/vertex/refine")
def vertex_refine_image():
    prompt = (request.form.get("prompt") or "").strip()
    if not prompt:
        return jsonify({"error": "Prompt is required"}), 400

    image_file = request.files.get("image")
    if image_file is None:
        return jsonify({"error": "Missing image file"}), 400

    image_bytes = image_file.read()
    if not image_bytes:
        return jsonify({"error": "Empty image file"}), 400

    image_b64 = base64.b64encode(image_bytes).decode("utf-8")
    image_obj = {"mimeType": "image/png", "bytesBase64Encoded": image_b64}

    img_plain = {"bytesBase64Encoded": image_b64}

    instance = {
        "prompt": prompt,
        "referenceImages": [
            {"referenceType": "REFERENCE_TYPE_RAW", "referenceId": 1, "referenceImage": img_plain},
        ],
    }
    parameters = {"sampleCount": 4, "editConfig": {"editMode": "inpainting-insert"}}

    try:
        prediction = _vertex_predict(VERTEX_INPAINT_MODEL, instances=[instance], parameters=parameters, timeout=120)
        raw = prediction.get("predictions") or []
        print(f"[vertex/refine] got {len(raw)} predictions", flush=True)
        images_b64 = _extract_all_prediction_images_b64(prediction)
        return jsonify({"images": images_b64})
    except Exception as exc:
        return jsonify({"error": f"Vertex refine failed: {exc}"}), 500


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
    img_plain = {"bytesBase64Encoded": image_b64}
    msk_plain = {"bytesBase64Encoded": mask_b64}

    instance = {
        "prompt": prompt,
        "referenceImages": [
            {"referenceType": "REFERENCE_TYPE_RAW", "referenceId": 1, "referenceImage": img_plain},
            {"referenceType": "REFERENCE_TYPE_MASK", "referenceId": 2, "referenceImage": msk_plain,
             "maskImageConfig": {"maskMode": "MASK_MODE_USER_PROVIDED"}},
        ],
    }
    parameters = {"sampleCount": 1, "editConfig": {"editMode": "inpainting-insert"}}

    try:
        prediction = _vertex_predict(VERTEX_INPAINT_MODEL, instances=[instance], parameters=parameters, timeout=120)
        output_bytes = _extract_prediction_image_bytes(prediction)
        print(f"[vertex/inpaint] success", flush=True)
        return send_file(
            BytesIO(output_bytes),
            mimetype="image/png",
            as_attachment=False,
            download_name="vertex_inpainted.png",
        )
    except Exception as exc:
        return jsonify({"error": f"Vertex inpainting failed: {exc}"}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
