import base64
import json
import logging
import os
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from threading import Lock
from typing import Any

from flask import Flask, Response, jsonify, request, send_file, send_from_directory
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2 import service_account
from PIL import Image
import requests

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder="static", static_url_path="/static")

MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MB
_PNG_MAGIC = b"\x89PNG"
_JPEG_MAGIC = b"\xff\xd8\xff"
_WEBP_MAGIC = b"RIFF"


def _read_validated_image(file_storage: Any) -> bytes:
    """Read an uploaded image, enforcing size and basic format checks."""
    data = file_storage.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError("Image too large (20 MB max)")
    if not (data[:4] in (_PNG_MAGIC, _JPEG_MAGIC) or data[:4] == _WEBP_MAGIC):
        raise ValueError("Unsupported image format — send PNG, JPEG, or WebP")
    return data


def api_error(message: str, status: int = 400) -> tuple[Response, int]:
    """Return a standardised JSON error response."""
    return jsonify({"error": message}), status


_rembg_lock = Lock()
_rembg_remove = None
_rembg_session = None

_vertex_lock = Lock()
_vertex_credentials: Any = None
_vertex_project_id: str | None = None


@dataclass
class VertexConfig:
    location: str
    generate_model: str
    inpaint_model: str
    credentials_path: Path

    @classmethod
    def from_env(cls) -> "VertexConfig":
        return cls(
            location=os.getenv("VERTEX_LOCATION", "us-central1"),
            generate_model=os.getenv("VERTEX_GENERATE_MODEL", "imagen-4.0-generate-001"),
            inpaint_model=os.getenv("VERTEX_INPAINT_MODEL", "imagen-3.0-capability-001"),
            credentials_path=Path(
                os.getenv(
                    "VERTEX_CREDENTIALS_PATH",
                    str(Path(__file__).resolve().parents[1] / "vertex.json"),
                )
            ),
        )


vertex_cfg = VertexConfig.from_env()


def _load_vertex_credentials() -> None:
    global _vertex_credentials, _vertex_project_id

    if _vertex_credentials is not None and _vertex_project_id:
        return

    if not vertex_cfg.credentials_path.exists():
        raise FileNotFoundError(
            f"Vertex credentials file not found: {vertex_cfg.credentials_path}"
        )

    with vertex_cfg.credentials_path.open("r", encoding="utf-8") as f:
        info = json.load(f)

    project_id = info.get("project_id")
    if not project_id:
        raise ValueError("project_id missing in vertex credentials JSON")

    _vertex_credentials = service_account.Credentials.from_service_account_info(
        info,
        scopes=["https://www.googleapis.com/auth/cloud-platform"],
    )
    _vertex_project_id = project_id


def _get_vertex_access_token_and_project() -> tuple[str, str]:
    with _vertex_lock:
        _load_vertex_credentials()

        if not _vertex_credentials.valid or _vertex_credentials.expired:
            _vertex_credentials.refresh(GoogleAuthRequest())

        return _vertex_credentials.token, _vertex_project_id


def _vertex_predict(
    model_name: str,
    instances: list[dict],
    parameters: dict,
    timeout: int = 300,
) -> dict:
    token, project_id = _get_vertex_access_token_and_project()

    endpoint = (
        f"https://{vertex_cfg.location}-aiplatform.googleapis.com/v1/projects/{project_id}/"
        f"locations/{vertex_cfg.location}/publishers/google/models/{model_name}:predict"
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


def _make_white_mask_b64(image_bytes: bytes) -> str:
    """Return a base64-encoded full-white PNG with the same dimensions as image_bytes."""
    src = Image.open(BytesIO(image_bytes))
    mask = Image.new("RGB", src.size, (255, 255, 255))
    buf = BytesIO()
    mask.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _extract_prediction_image_bytes(prediction_response: dict) -> bytes:
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


def _extract_all_prediction_images_b64(prediction_response: dict) -> list[str]:
    predictions = prediction_response.get("predictions") or []
    if not predictions:
        raise ValueError("No predictions returned by Vertex")

    results: list[str] = []
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


@app.get("/health")
def health() -> Response:
    return jsonify({"status": "ok"})


@app.route("/")
def index() -> Response:
    return send_from_directory("static", "index.html")


@app.post("/api/remove-background")
def remove_background() -> Response | tuple[Response, int]:
    global _rembg_remove, _rembg_session

    try:
        if _rembg_remove is None or _rembg_session is None:
            with _rembg_lock:
                if _rembg_remove is None or _rembg_session is None:
                    from rembg import new_session, remove

                    _rembg_remove = remove
                    _rembg_session = new_session("u2net")
    except Exception as exc:
        return api_error(f"rembg backend unavailable: {exc}", 503)

    file = request.files.get("image")
    if file is None:
        return api_error("Missing image file")

    try:
        data = _read_validated_image(file)
    except ValueError as exc:
        return api_error(str(exc))

    try:
        output = _rembg_remove(data, session=_rembg_session)
    except Exception as exc:
        return api_error(f"AI background removal failed: {exc}", 500)

    return send_file(
        BytesIO(output),
        mimetype="image/png",
        as_attachment=False,
        download_name="background_removed.png",
    )


_ALLOWED_GENERATE_MODELS = {
    "imagen-4.0-generate-001",
    "imagen-4.0-ultra-generate-001",
    "imagen-3.0-generate-001",
}

_ALLOWED_ASPECT_RATIOS = {"1:1", "4:3", "16:9", "9:16", "3:4"}


@app.post("/api/vertex/generate")
def vertex_generate_image() -> Response | tuple[Response, int]:
    payload = request.get_json(silent=True) or {}
    prompt = (payload.get("prompt") or "").strip()
    if not prompt:
        return api_error("Prompt is required")

    model = (payload.get("model") or vertex_cfg.generate_model).strip()
    if model not in _ALLOWED_GENERATE_MODELS:
        model = vertex_cfg.generate_model

    aspect_ratio = (payload.get("aspectRatio") or "1:1").strip()
    if aspect_ratio not in _ALLOWED_ASPECT_RATIOS:
        aspect_ratio = "1:1"

    try:
        prediction = _vertex_predict(
            model,
            instances=[{"prompt": prompt}],
            parameters={
                "sampleCount": 4,
                "aspectRatio": aspect_ratio,
                "outputOptions": {"mimeType": "image/png"},
            },
        )
        raw_predictions = prediction.get("predictions") or []
        logger.info("[vertex/generate] requested 4, got %d predictions back", len(raw_predictions))
        images_b64 = _extract_all_prediction_images_b64(prediction)
        logger.info("[vertex/generate] extracted %d images", len(images_b64))
    except Exception as exc:
        return api_error(f"Vertex generate failed: {exc}", 500)

    return jsonify({"images": images_b64})


@app.post("/api/vertex/refine")
def vertex_refine_image() -> Response | tuple[Response, int]:
    prompt = (request.form.get("prompt") or "").strip()
    if not prompt:
        return api_error("Prompt is required")

    image_file = request.files.get("image")
    if image_file is None:
        return api_error("Missing image file")

    try:
        image_bytes = _read_validated_image(image_file)
    except ValueError as exc:
        return api_error(str(exc))

    image_b64 = base64.b64encode(image_bytes).decode("utf-8")
    img_plain = {"bytesBase64Encoded": image_b64}

    instance = {
        "prompt": prompt,
        "referenceImages": [
            {"referenceType": "REFERENCE_TYPE_RAW", "referenceId": 1, "referenceImage": img_plain},
        ],
    }
    parameters = {"sampleCount": 4, "editConfig": {"editMode": "inpainting-insert"}}

    try:
        prediction = _vertex_predict(
            vertex_cfg.inpaint_model, instances=[instance], parameters=parameters, timeout=120
        )
        raw = prediction.get("predictions") or []
        logger.info("[vertex/refine] got %d predictions", len(raw))
        images_b64 = _extract_all_prediction_images_b64(prediction)
        return jsonify({"images": images_b64})
    except Exception as exc:
        return api_error(f"Vertex refine failed: {exc}", 500)


@app.post("/api/describe")
def describe_image() -> Response | tuple[Response, int]:
    """Use Gemini vision via Vertex AI to analyse the canvas and suggest a generation prompt."""
    image_file = request.files.get("image")
    if image_file is None:
        return api_error("Missing image file")

    try:
        image_bytes = _read_validated_image(image_file)
    except ValueError as exc:
        return api_error(str(exc))

    image_b64 = base64.b64encode(image_bytes).decode("utf-8")
    if image_bytes[:4] == _PNG_MAGIC:
        mime_type = "image/png"
    elif image_bytes[:3] == _JPEG_MAGIC[:3]:
        mime_type = "image/jpeg"
    else:
        mime_type = "image/webp"

    try:
        token, project_id = _get_vertex_access_token_and_project()
        endpoint = (
            f"https://{vertex_cfg.location}-aiplatform.googleapis.com/v1/projects/{project_id}/"
            f"locations/{vertex_cfg.location}/publishers/google/models/gemini-2.0-flash:generateContent"
        )
        payload = {
            "contents": [{
                "role": "user",
                "parts": [
                    {"inlineData": {"mimeType": mime_type, "data": image_b64}},
                    {"text": (
                        "Describe this image as a concise text-to-image generation prompt "
                        "(under 60 words). Focus on subject, style, lighting, and mood. "
                        "Return only the prompt text, no explanation or preamble."
                    )},
                ],
            }],
            "generationConfig": {"maxOutputTokens": 256, "temperature": 0.4},
        }
        response = requests.post(
            endpoint,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=payload,
            timeout=30,
        )
        if not response.ok:
            raise RuntimeError(f"Gemini describe failed ({response.status_code}): {response.text[:400]}")
        result = response.json()
        suggestion = result["candidates"][0]["content"]["parts"][0]["text"].strip()
        logger.info("[describe] generated prompt suggestion (%d chars)", len(suggestion))
        return jsonify({"prompt": suggestion})
    except Exception as exc:
        return api_error(f"AI describe failed: {exc}", 500)


@app.post("/api/vertex/upscale")
def vertex_upscale_image() -> Response | tuple[Response, int]:
    image_file = request.files.get("image")
    if image_file is None:
        return api_error("Missing image file")

    try:
        image_bytes = _read_validated_image(image_file)
    except ValueError as exc:
        return api_error(str(exc))

    image_b64 = base64.b64encode(image_bytes).decode("utf-8")

    try:
        prediction = _vertex_predict(
            "imagegeneration@006",
            instances=[{"prompt": "", "image": {"bytesBase64Encoded": image_b64}}],
            parameters={"sampleCount": 1, "upscaleConfig": {"upscaleFactor": "x2"}},
            timeout=180,
        )
        output_bytes = _extract_prediction_image_bytes(prediction)
        logger.info("[vertex/upscale] success")
        return send_file(
            BytesIO(output_bytes),
            mimetype="image/png",
            as_attachment=False,
            download_name="vertex_upscaled.png",
        )
    except Exception as exc:
        return api_error(f"Vertex upscale failed: {exc}", 500)


@app.post("/api/vertex/remove")
def vertex_remove_object() -> Response | tuple[Response, int]:
    """Remove a masked object using Vertex inpainting-remove mode."""
    image_file = request.files.get("image")
    mask_file = request.files.get("mask")
    if image_file is None or mask_file is None:
        return api_error("Both image and mask files are required")

    try:
        image_bytes = _read_validated_image(image_file)
        mask_bytes = _read_validated_image(mask_file)
    except ValueError as exc:
        return api_error(str(exc))

    image_b64 = base64.b64encode(image_bytes).decode("utf-8")
    mask_b64 = base64.b64encode(mask_bytes).decode("utf-8")
    # White = area to remove, black = area to keep (MASK_MODE_USER_PROVIDED convention).
    instance = {
        "prompt": "",
        "referenceImages": [
            {
                "referenceType": "REFERENCE_TYPE_RAW",
                "referenceId": 1,
                "referenceImage": {"bytesBase64Encoded": image_b64},
            },
            {
                "referenceType": "REFERENCE_TYPE_MASK",
                "referenceId": 2,
                "referenceImage": {"bytesBase64Encoded": mask_b64},
                "maskImageConfig": {
                    "maskMode": "MASK_MODE_USER_PROVIDED",
                    "dilation": 0.01,
                },
            },
        ],
    }
    parameters = {
        "editMode": "EDIT_MODE_INPAINT_REMOVAL",
        "editConfig": {"baseSteps": 12},
        "sampleCount": 1,
    }

    try:
        prediction = _vertex_predict(
            vertex_cfg.inpaint_model, instances=[instance], parameters=parameters, timeout=120
        )
        output_bytes = _extract_prediction_image_bytes(prediction)
        logger.info("[vertex/remove] success")
        return send_file(
            BytesIO(output_bytes),
            mimetype="image/png",
            as_attachment=False,
            download_name="vertex_removed.png",
        )
    except Exception as exc:
        return api_error(f"Vertex object removal failed: {exc}", 500)


@app.post("/api/vertex/inpaint")
def vertex_inpaint_image() -> Response | tuple[Response, int]:
    prompt = (request.form.get("prompt") or "").strip()
    if not prompt:
        return api_error("Prompt is required")

    image_file = request.files.get("image")
    mask_file = request.files.get("mask")
    if image_file is None or mask_file is None:
        return api_error("Both image and mask files are required")

    try:
        image_bytes = _read_validated_image(image_file)
        mask_bytes = _read_validated_image(mask_file)
    except ValueError as exc:
        return api_error(str(exc))

    image_b64 = base64.b64encode(image_bytes).decode("utf-8")
    mask_b64 = base64.b64encode(mask_bytes).decode("utf-8")

    instance = {
        "prompt": prompt,
        "referenceImages": [
            {
                "referenceType": "REFERENCE_TYPE_RAW",
                "referenceId": 1,
                "referenceImage": {"bytesBase64Encoded": image_b64},
            },
            {
                "referenceType": "REFERENCE_TYPE_MASK",
                "referenceId": 2,
                "referenceImage": {"bytesBase64Encoded": mask_b64},
                "maskImageConfig": {
                    "maskMode": "MASK_MODE_USER_PROVIDED",
                    "dilation": 0.01,
                },
            },
        ],
    }
    parameters = {
        "editMode": "EDIT_MODE_INPAINT_INSERTION",
        "editConfig": {"baseSteps": 12},
        "sampleCount": 1,
    }

    try:
        prediction = _vertex_predict(
            vertex_cfg.inpaint_model, instances=[instance], parameters=parameters, timeout=120
        )
        output_bytes = _extract_prediction_image_bytes(prediction)
        logger.info("[vertex/inpaint] success")
        return send_file(
            BytesIO(output_bytes),
            mimetype="image/png",
            as_attachment=False,
            download_name="vertex_inpainted.png",
        )
    except Exception as exc:
        return api_error(f"Vertex inpainting failed: {exc}", 500)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
