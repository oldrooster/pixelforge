# PixelForge

Browser-based image markup and AI editing tool. A Flask backend serves a vanilla-JS frontend that runs entirely on an HTML canvas. AI features use Google Vertex AI (Gemini image models, Veo video) through a service account. Background removal runs locally with rembg.

## Layout

```
app/main.py              Flask app: every API route, Vertex REST helpers, rembg, sessions (single file)
app/static/index.html    All UI markup (tool panels, settings, modals)
app/static/css/style.css
app/static/js/           Native ES modules, no bundler or build step; loaded via <script type="module" src="markup.js">
  markup.js   Entry point: wires all event listeners (tools, mouse, keyboard, drag/drop, paste, zoom/wheel)
  state.js    Single shared mutable `state` object; modules read and write it directly
  dom.js      Registry of every DOM element (`dom.xxx`) plus `canvas` and `ctx`
  canvas.js   Render loop, zoom, activateCanvas, composite helpers, crop/selection/resize, inpaint mask
  layers.js   Layer drawing and panel, undo/redo, flood fill, transparency fill, defringe, shapes
  thumbs.js   Thumbnail strip (images and videos), per-thumbnail saved state, loadImageFile
  ui.js       TOOL_CONFIG table (tool → panel/title/cursor), setTool, notices, status helpers
  api.js      Calls to the backend AI endpoints
  sessions.js Session browser modal (save/load/delete)
```

Other docs: `README.md` (features, env vars, shortcuts), `FEATURES.md` and `REFACTORING.md` (roadmaps with completed items struck through), `fix_shit.md` (the user's current bug and feature list).

## Conventions and gotchas

- **Adding a UI control:** add the markup in `index.html`, register it in `dom.js`, then wire the listener in `markup.js`. The logic usually goes in `layers.js` or `canvas.js`.
- **Adding a tool:** add a button `#tool-<name>` and a `#<name>-settings` panel, then add entries in `dom.toolButtons`, `TOOL_CONFIG` in `ui.js`, and the keyboard map in `markup.js` (`simpleTools`).
- **Circular imports** between canvas.js, layers.js and ui.js are intentional; ES live bindings handle them. Don't call imported functions at module top level.
- **Whole-image pixel operations** (transparency, defringe, crop, resize) follow one pattern: `buildCompositeCanvas()`, edit the ImageData, then `replaceWithRasterCanvas(canvas)`. That flattens the layers and pushes an undo step.
- **Thumbnails:** each slot keeps `savedState` (image, layers, undo). Call `saveCurrentThumbState()` before switching or loading a new image.
- **Mouse drags:** `mousedown` is on the canvas, while `mousemove` and `mouseup` are on `window` so drags keep tracking outside the canvas. Rectangle drags (crop/select) clamp and snap to whole pixels.
- **Wheel:** a plain wheel scrolls the canvas; Ctrl/Cmd+wheel zooms toward the cursor.
- **Styling:** 4-space indent, double quotes in JS, and section headers `// ----` / `# ----`.
- **Backend:** new routes use `api_error(msg, status)` for errors and `_read_validated_image()` for uploads, which enforce the 20 MB limit and PNG/JPEG/WEBP magic bytes.

## Running and testing

Docker is the source of truth (Python 3.12). The local `.venv` is stale and incomplete, so don't rely on it.

```bash
docker compose up --build -d          # http://localhost:5000 (mounts ./vertex.json)
curl -f localhost:5000/health
docker compose down
```

- Without Docker: `python3.12 -m venv .venv && .venv/bin/pip install -r requirements.lock && .venv/bin/flask --app app.main:app run --debug`
- **No valid Vertex credentials are available.** AI generate, img-to-img, inpaint, remove, describe and video can't be tested end to end; only check that they fail gracefully. rembg (`/api/remove-background`) works offline after the first u2net model download (~170 MB).
- There's no automated test suite or linter. To verify: run `node --check app/static/js/*.js` and smoke-test the endpoints with curl.
- **Browser testing:** the host is missing the system libraries Chromium needs, so run Playwright from its Docker image against the app on the host:
  `docker run --rm --network host -v "$DIR":/t -w /t mcr.microsoft.com/playwright:v1.59.1-noble node test.mjs` (the script imports `playwright-core`, installed via npm in `$DIR`).
  Inside the page, `await import("/static/js/state.js")` returns the live app state, because it's the same module instance, so you can assert on `state.thumbSlots`, `state.selectionRect` and so on. Use `buildCompositeCanvas()` from canvas.js to read pixels.

## Dependencies

- `requirements.txt` holds major-version ranges, and `requirements.lock` holds exact pins (generated with pip-compile). The Dockerfile installs from the **lock**.
- To update: regenerate the lock under Python 3.12 (the Docker base), not the host's python3 (3.10):
  `docker run --rm -v "$PWD":/w -w /w python:3.12-slim sh -c "pip install -q pip-tools && pip-compile --upgrade --strip-extras -o requirements.lock requirements.txt"`

## Security notes

- `vertex.json` is a service-account key. It must never be printed, logged or sent anywhere. It was committed to git historically; see the README/user before touching history.
