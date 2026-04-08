from io import BytesIO
from threading import Lock

from flask import Flask, jsonify, request, send_file, send_from_directory

app = Flask(__name__, static_folder="static", static_url_path="/static")

_rembg_lock = Lock()
_rembg_remove = None
_rembg_session = None


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


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
