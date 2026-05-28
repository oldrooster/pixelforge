import base64
import json
import logging
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from threading import Lock, Thread
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


# ---------------------------------------------------------------------------
# rembg (background removal)
# ---------------------------------------------------------------------------
_rembg_lock = Lock()
_rembg_remove = None
_rembg_session = None

# ---------------------------------------------------------------------------
# Vertex AI credentials
# ---------------------------------------------------------------------------
_vertex_lock = Lock()
_vertex_credentials: Any = None
_vertex_project_id: str | None = None


@dataclass
class VertexConfig:
    location: str
    generate_model: str
    credentials_path: Path

    @classmethod
    def from_env(cls) -> "VertexConfig":
        return cls(
            location=os.getenv("VERTEX_LOCATION", "us-central1"),
            generate_model=os.getenv("VERTEX_GENERATE_MODEL", "gemini-2.5-flash-image"),
            credentials_path=Path(
                os.getenv(
                    "VERTEX_CREDENTIALS_PATH",
                    str(Path(__file__).resolve().parents[1] / "vertex.json"),
                )
            ),
        )


vertex_cfg = VertexConfig.from_env()

# ---------------------------------------------------------------------------
# Sessions config
# ---------------------------------------------------------------------------
_SESSIONS_DIR_RAW = os.getenv("SESSIONS_DIR", "")
SESSIONS_DIR = Path(_SESSIONS_DIR_RAW) if _SESSIONS_DIR_RAW else None


def _sessions_enabled() -> bool:
    return SESSIONS_DIR is not None and SESSIONS_DIR.exists()


# ---------------------------------------------------------------------------
# Vertex AI credential management
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# Vertex AI REST helpers
# ---------------------------------------------------------------------------
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


# Models routed to the global endpoint (regional us-central1 returns 404 for these).
_GLOBAL_LOCATION_MODELS = {
    "gemini-3-pro-image-preview",
    "gemini-3.1-flash-image-preview",
}


def _vertex_generate_content(
    model_name: str,
    contents: list[dict],
    generation_config: dict,
    timeout: int = 120,
) -> dict:
    """Call the Vertex AI generateContent endpoint (Gemini image generation models)."""
    token, project_id = _get_vertex_access_token_and_project()
    if model_name in _GLOBAL_LOCATION_MODELS:
        endpoint = (
            f"https://aiplatform.googleapis.com/v1/projects/{project_id}/"
            f"locations/global/publishers/google/models/{model_name}:generateContent"
        )
    else:
        endpoint = (
            f"https://{vertex_cfg.location}-aiplatform.googleapis.com/v1/projects/{project_id}/"
            f"locations/{vertex_cfg.location}/publishers/google/models/{model_name}:generateContent"
        )
    response = requests.post(
        endpoint,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"contents": contents, "generationConfig": generation_config},
        timeout=timeout,
    )
    if not response.ok:
        raise RuntimeError(
            f"Vertex generateContent failed ({response.status_code}): {response.text[:600]}"
        )
    return response.json()


def _extract_gemini_images_b64(response: dict) -> list[str]:
    """Extract all base64-encoded images from a Gemini generateContent response."""
    images: list[str] = []
    for candidate in response.get("candidates", []):
        for part in candidate.get("content", {}).get("parts", []):
            inline = part.get("inlineData")
            if inline and inline.get("data"):
                images.append(inline["data"])
    return images


def _annotate_image_with_mask(
    image_bytes: bytes,
    mask_bytes: bytes,
    color: tuple[int, int, int],
    alpha: int = 160,
) -> bytes:
    """Composite a semi-transparent coloured overlay on the masked region so Gemini can
    identify the target area visually (since it has no native mask support)."""
    orig = Image.open(BytesIO(image_bytes)).convert("RGBA")
    mask_gray = Image.open(BytesIO(mask_bytes)).convert("L")
    overlay = Image.new("RGBA", orig.size, color + (alpha,))
    scaled_alpha = mask_gray.point(lambda p: int(p * alpha / 255))
    overlay.putalpha(scaled_alpha)
    result = Image.alpha_composite(orig, overlay).convert("RGB")
    buf = BytesIO()
    result.save(buf, format="PNG")
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Routes: health / index
# ---------------------------------------------------------------------------
@app.get("/health")
def health() -> Response:
    return jsonify({"status": "ok"})


@app.route("/")
def index() -> Response:
    return send_from_directory("static", "index.html")


# ---------------------------------------------------------------------------
# Route: background removal
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# Routes: Gemini image generation / editing
# ---------------------------------------------------------------------------
_ALLOWED_GENERATE_MODELS = {
    "gemini-2.5-flash-image",
    "gemini-3.1-flash-image-preview",
    "gemini-3-pro-image-preview",
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

    count = max(1, min(4, int(payload.get("count") or 4)))

    contents = [{"role": "user", "parts": [{"text": prompt}]}]
    gen_config = {
        "responseModalities": ["IMAGE"],
        "imageConfig": {"aspectRatio": aspect_ratio},
    }

    try:
        def _one():
            imgs = _extract_gemini_images_b64(
                _vertex_generate_content(model, contents, gen_config, timeout=120)
            )
            return imgs[0] if imgs else None

        images_b64: list[str] = []
        with ThreadPoolExecutor(max_workers=count) as pool:
            for img in as_completed([pool.submit(_one) for _ in range(count)]):
                result = img.result()
                if result:
                    images_b64.append(result)

        if not images_b64:
            raise ValueError("No images returned by Gemini.")
        logger.info("[vertex/generate] got %d images", len(images_b64))
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
    contents = [{
        "role": "user",
        "parts": [
            {"inlineData": {"mimeType": "image/png", "data": image_b64}},
            {"text": prompt},
        ],
    }]
    gen_config = {"responseModalities": ["IMAGE"]}
    count = max(1, min(4, int(request.form.get("count") or 4)))

    try:
        model = vertex_cfg.generate_model

        def _one():
            imgs = _extract_gemini_images_b64(
                _vertex_generate_content(model, contents, gen_config, timeout=120)
            )
            return imgs[0] if imgs else None

        images_b64: list[str] = []
        with ThreadPoolExecutor(max_workers=count) as pool:
            for fut in as_completed([pool.submit(_one) for _ in range(count)]):
                result = fut.result()
                if result:
                    images_b64.append(result)

        if not images_b64:
            raise ValueError("No images returned by Gemini.")
        logger.info("[vertex/refine] got %d images", len(images_b64))
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
    mime_type = (
        "image/png" if image_bytes[:4] == _PNG_MAGIC
        else "image/jpeg" if image_bytes[:3] == _JPEG_MAGIC[:3]
        else "image/webp"
    )

    try:
        result = _vertex_generate_content(
            "gemini-2.0-flash",
            contents=[{
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
            generation_config={"maxOutputTokens": 256, "temperature": 0.4},
            timeout=30,
        )
        suggestion = result["candidates"][0]["content"]["parts"][0]["text"].strip()
        logger.info("[describe] generated prompt suggestion (%d chars)", len(suggestion))
        return jsonify({"prompt": suggestion})
    except Exception as exc:
        return api_error(f"AI describe failed: {exc}", 500)


@app.post("/api/vertex/remove")
def vertex_remove_object() -> Response | tuple[Response, int]:
    """Remove a painted object using Gemini image editing (mask rendered as red overlay)."""
    image_file = request.files.get("image")
    mask_file = request.files.get("mask")
    if image_file is None or mask_file is None:
        return api_error("Both image and mask files are required")

    try:
        image_bytes = _read_validated_image(image_file)
        mask_bytes = _read_validated_image(mask_file)
    except ValueError as exc:
        return api_error(str(exc))

    try:
        annotated_bytes = _annotate_image_with_mask(image_bytes, mask_bytes, color=(220, 40, 40), alpha=180)
    except Exception as exc:
        return api_error(f"Mask annotation failed: {exc}", 500)

    annotated_b64 = base64.b64encode(annotated_bytes).decode("utf-8")
    contents = [{
        "role": "user",
        "parts": [
            {"inlineData": {"mimeType": "image/png", "data": annotated_b64}},
            {"text": (
                "Remove the content highlighted in red from this image. "
                "Fill the removed area naturally with the surrounding background, "
                "textures, and patterns so the result looks seamless. "
                "Keep everything outside the red region exactly as it is."
            )},
        ],
    }]

    try:
        result = _vertex_generate_content(
            vertex_cfg.generate_model, contents, {"responseModalities": ["IMAGE"]}, timeout=120
        )
        imgs = _extract_gemini_images_b64(result)
        if not imgs:
            raise ValueError("No image returned by Gemini.")
        output_bytes = base64.b64decode(imgs[0])
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
    """Inpaint a selected region using Gemini image editing (mask rendered as blue overlay)."""
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

    try:
        annotated_bytes = _annotate_image_with_mask(image_bytes, mask_bytes, color=(30, 100, 255), alpha=160)
    except Exception as exc:
        return api_error(f"Mask annotation failed: {exc}", 500)

    annotated_b64 = base64.b64encode(annotated_bytes).decode("utf-8")
    contents = [{
        "role": "user",
        "parts": [
            {"inlineData": {"mimeType": "image/png", "data": annotated_b64}},
            {"text": (
                f"Edit only the blue-highlighted region of this image. "
                f"Replace the blue region with: {prompt}. "
                f"Keep everything outside the blue region exactly as it is."
            )},
        ],
    }]

    try:
        result = _vertex_generate_content(
            vertex_cfg.generate_model, contents, {"responseModalities": ["IMAGE"]}, timeout=120
        )
        imgs = _extract_gemini_images_b64(result)
        if not imgs:
            raise ValueError("No image returned by Gemini.")
        output_bytes = base64.b64decode(imgs[0])
        logger.info("[vertex/inpaint] success")
        return send_file(
            BytesIO(output_bytes),
            mimetype="image/png",
            as_attachment=False,
            download_name="vertex_inpainted.png",
        )
    except Exception as exc:
        return api_error(f"Vertex inpainting failed: {exc}", 500)


# ---------------------------------------------------------------------------
# Routes: Sessions
# ---------------------------------------------------------------------------
@app.get("/api/sessions")
def list_sessions() -> Response | tuple[Response, int]:
    if not _sessions_enabled():
        return api_error("Sessions storage not configured (set SESSIONS_DIR env var)", 503)

    sessions = []
    for path in sorted(SESSIONS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            sessions.append({
                "id": data["id"],
                "name": data.get("name", "Untitled"),
                "created_at": data.get("created_at", ""),
                "thumbnail_b64": data.get("thumbnail_b64", ""),
            })
        except Exception:
            continue

    return jsonify(sessions)


@app.post("/api/sessions")
def save_session() -> Response | tuple[Response, int]:
    if not _sessions_enabled():
        return api_error("Sessions storage not configured (set SESSIONS_DIR env var)", 503)

    payload = request.get_json(silent=True) or {}
    image_b64 = (payload.get("image_b64") or "").strip()
    if not image_b64:
        return api_error("image_b64 is required")

    name = (payload.get("name") or "").strip() or f"Session {time.strftime('%Y-%m-%d %H:%M')}"
    session_id = str(uuid.uuid4())
    created_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    try:
        image_bytes = base64.b64decode(image_b64.split(",")[-1])
        img = Image.open(BytesIO(image_bytes)).convert("RGB")
        thumb_w = 200
        thumb_h = int(img.height * thumb_w / img.width)
        thumb = img.resize((thumb_w, thumb_h), Image.LANCZOS)
        thumb_buf = BytesIO()
        thumb.save(thumb_buf, format="JPEG", quality=80)
        thumbnail_b64 = base64.b64encode(thumb_buf.getvalue()).decode()
    except Exception as exc:
        return api_error(f"Failed to process image: {exc}", 400)

    session_data = {
        "id": session_id,
        "name": name,
        "created_at": created_at,
        "thumbnail_b64": thumbnail_b64,
        "image_b64": image_b64,
    }

    try:
        SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
        (SESSIONS_DIR / f"{session_id}.json").write_text(
            json.dumps(session_data), encoding="utf-8"
        )
    except Exception as exc:
        return api_error(f"Failed to save session: {exc}", 500)

    logger.info("[sessions] saved session %s (%s)", session_id, name)
    return jsonify({"id": session_id, "name": name, "created_at": created_at})


@app.get("/api/sessions/<session_id>")
def load_session(session_id: str) -> Response | tuple[Response, int]:
    if not _sessions_enabled():
        return api_error("Sessions storage not configured", 503)

    path = SESSIONS_DIR / f"{session_id}.json"
    if not path.exists():
        return api_error("Session not found", 404)

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return api_error(f"Failed to read session: {exc}", 500)

    return jsonify({
        "id": data["id"],
        "name": data.get("name", "Untitled"),
        "created_at": data.get("created_at", ""),
        "image_b64": data.get("image_b64", ""),
    })


@app.delete("/api/sessions/<session_id>")
def delete_session(session_id: str) -> Response | tuple[Response, int]:
    if not _sessions_enabled():
        return api_error("Sessions storage not configured", 503)

    path = SESSIONS_DIR / f"{session_id}.json"
    if not path.exists():
        return api_error("Session not found", 404)

    try:
        path.unlink()
    except Exception as exc:
        return api_error(f"Failed to delete session: {exc}", 500)

    logger.info("[sessions] deleted session %s", session_id)
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Routes: Veo video generation
# ---------------------------------------------------------------------------
_ALLOWED_VIDEO_MODELS = {
    "veo-2.0-generate-001",
    "veo-3.0-generate-001",
}
_ALLOWED_VIDEO_DURATIONS = {4, 6, 8}
_ALLOWED_VIDEO_ASPECT_RATIOS = {"16:9", "9:16", "1:1"}

_video_tasks: dict[str, dict] = {}


def _run_video_generation(
    task_id: str,
    token: str,
    project_id: str,
    model: str,
    prompt: str,
    image_b64: str,
    duration: int,
    aspect_ratio: str,
) -> None:
    """Background thread: start Veo long-running operation and poll until done."""
    try:
        endpoint = (
            f"https://{vertex_cfg.location}-aiplatform.googleapis.com/v1/projects/{project_id}/"
            f"locations/{vertex_cfg.location}/publishers/google/models/{model}:predictLongRunning"
        )
        body: dict = {
            "instances": [{
                "prompt": prompt,
                "referenceImages": [{
                    "image": {"bytesBase64Encoded": image_b64, "mimeType": "image/png"},
                    "referenceType": "asset",
                }],
            }],
            "parameters": {
                "durationSeconds": duration,
                "aspectRatio": aspect_ratio,
                "sampleCount": 1,
            },
        }

        resp = requests.post(
            endpoint,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=body,
            timeout=60,
        )
        if not resp.ok:
            raise RuntimeError(f"Veo start failed ({resp.status_code}): {resp.text[:600]}")

        operation_name = resp.json().get("name")
        if not operation_name:
            raise RuntimeError("No operation name returned by Veo")

        logger.info("[video/%s] operation started: %s", task_id, operation_name)

        poll_url = (
            f"https://{vertex_cfg.location}-aiplatform.googleapis.com/v1/{operation_name}"
        )
        deadline = time.time() + 600  # 10-minute hard cap
        while time.time() < deadline:
            time.sleep(5)
            # Refresh token before each poll
            fresh_token, _ = _get_vertex_access_token_and_project()
            poll_resp = requests.get(
                poll_url,
                headers={"Authorization": f"Bearer {fresh_token}"},
                timeout=30,
            )
            if not poll_resp.ok:
                raise RuntimeError(f"Poll failed ({poll_resp.status_code}): {poll_resp.text[:400]}")

            op = poll_resp.json()
            if not op.get("done"):
                continue

            if op.get("error"):
                raise RuntimeError(f"Veo operation error: {op['error']}")

            # Extract video bytes
            response_payload = op.get("response", {})
            videos = response_payload.get("videos") or response_payload.get("predictions") or []
            if not videos:
                raise RuntimeError("No videos in completed operation response")

            video_b64 = videos[0].get("bytesBase64Encoded") or videos[0].get("videoBytes")
            if not video_b64:
                raise RuntimeError("Could not extract video bytes from response")

            _video_tasks[task_id] = {"status": "complete", "videoB64": video_b64, "error": None}
            logger.info("[video/%s] complete", task_id)
            return

        raise RuntimeError("Video generation timed out after 10 minutes")

    except Exception as exc:
        logger.error("[video/%s] failed: %s", task_id, exc)
        _video_tasks[task_id] = {"status": "error", "videoB64": None, "error": str(exc)}


@app.post("/api/vertex/generate-video")
def vertex_generate_video() -> Response | tuple[Response, int]:
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

    model = (request.form.get("model") or "veo-2.0-generate-001").strip()
    if model not in _ALLOWED_VIDEO_MODELS:
        model = "veo-2.0-generate-001"

    try:
        duration = int(request.form.get("durationSeconds") or 8)
    except ValueError:
        duration = 8
    if duration not in _ALLOWED_VIDEO_DURATIONS:
        duration = 8

    aspect_ratio = (request.form.get("aspectRatio") or "16:9").strip()
    if aspect_ratio not in _ALLOWED_VIDEO_ASPECT_RATIOS:
        aspect_ratio = "16:9"

    image_b64 = base64.b64encode(image_bytes).decode("utf-8")
    task_id = str(uuid.uuid4())

    try:
        token, project_id = _get_vertex_access_token_and_project()
    except Exception as exc:
        return api_error(f"Auth failed: {exc}", 500)

    _video_tasks[task_id] = {"status": "pending", "videoB64": None, "error": None, "started_at": time.time()}

    thread = Thread(
        target=_run_video_generation,
        args=(task_id, token, project_id, model, prompt, image_b64, duration, aspect_ratio),
        daemon=True,
    )
    thread.start()

    logger.info("[video] started task %s model=%s dur=%ds", task_id, model, duration)
    return jsonify({"taskId": task_id})


@app.get("/api/vertex/video-status/<task_id>")
def vertex_video_status(task_id: str) -> Response | tuple[Response, int]:
    task = _video_tasks.get(task_id)
    if task is None:
        return api_error("Unknown task ID", 404)

    elapsed = round(time.time() - task.get("started_at", time.time()))
    return jsonify({
        "status": task["status"],
        "videoB64": task.get("videoB64"),
        "error": task.get("error"),
        "elapsed": elapsed,
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
