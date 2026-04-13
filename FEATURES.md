# PixelForge — Recommended Feature Additions

Features are grouped by theme. Each entry notes the effort level and which parts of the stack would be touched.

---

## Canvas & Editing

### F1 — Eraser tool
A dedicated eraser that makes pixels transparent rather than painting over them. Complements the transparency fill and would work with the existing brush layer system. Low effort — reuses brush drawing code with `globalCompositeOperation = "destination-out"`.

### F2 — Opacity / blend mode per layer
Each layer currently renders at full opacity. Adding a per-layer opacity slider and a blend mode dropdown (multiply, screen, overlay, etc.) would open up basic compositing workflows. The layer data object would gain `opacity` and `blendMode` fields; `drawLayer` would apply them via `ctx.globalAlpha` and `ctx.globalCompositeOperation`.

### ~~F3 — Layer reorder by drag~~ ✅
~~The layers panel shows layers but reordering requires buttons. Drag-and-drop reorder (using the HTML5 drag API or pointer events) would be more intuitive and matches expectations from tools like Figma and Photoshop.~~

### ~~F4 — Layer merge~~ ✅
~~A "Merge down" or "Flatten all layers" button that rasterises selected layers into a single brush layer. Useful before exporting or doing AI operations on the result.~~

### ~~F5 — Stroke smoothing for brush~~ ✅
~~Freehand brush strokes currently follow the raw pointer path. Applying Catmull-Rom or Bézier curve smoothing between captured points would produce much cleaner strokes. No backend changes needed.~~

### ~~F6 — Magic wand / contiguous select~~ ✅
~~A selection tool that selects a contiguous region by color tolerance (like the existing fill tool, but producing a selection rather than filling). Works well as a precursor to inpainting — select a region then run inpaint, without having to manually draw a selection box.~~

### ~~F7 — Text editing on existing layers~~ ✅
~~Currently clicking a text layer places a new one. Adding the ability to double-click an existing text layer to re-open an edit prompt would significantly improve the text workflow.~~

---

## AI Features

### F8 — Prompt history / suggestions
Store the last N prompts in `localStorage` and show them as a dropdown or autocomplete on the generate/refine/inpaint inputs. Small frontend-only change.

### ~~F9 — Generate model selector~~ ✅
~~Expose the `VERTEX_GENERATE_MODEL` as a dropdown in the UI (e.g. imagen-3, imagen-4, imagen-4-ultra) so users can trade speed for quality without restarting the server. Requires passing the model name in the API request body.~~

### ~~F10 — Aspect ratio presets for AI Generate~~ ✅
~~When generating from scratch there is no canvas — so the output dimensions are whatever Vertex returns. Adding preset aspect ratio buttons (1:1, 4:3, 16:9, 9:16) that set the Vertex `aspectRatio` parameter would give users control over output shape.~~

### ~~F11 — AI upscale / super-resolution~~ ✅
~~Vertex AI offers an upscale mode. An "AI Upscale" button sends the current canvas and returns it at 2× resolution via `/api/vertex/upscale` using `imagegeneration@006`.~~

### ~~F12 — Object removal~~ ✅
~~An inpaint preset specifically for object removal: paint over the object, submit with an empty prompt or a fixed "remove object, fill background naturally" prompt. This is just a UX affordance on top of the existing inpaint endpoint.~~

### ~~F13 — AI describe / auto-prompt~~ ✅
~~Use a vision model (e.g. Claude) to analyse the current canvas and suggest a prompt for the refine or generate tools. A small "Describe" button next to the prompt textarea that calls a new `/api/describe` endpoint returning a text suggestion.~~

---

## File & Project Management

### F14 — Multiple image tabs / sessions
Currently one image is open at a time. A tab bar at the top would let users work on several images in parallel without losing their layers or history. The thumbnail slot system is the foundation for this — it could be generalised from "AI result slots" to "open files".

### F15 — Save project as JSON
Export the full editor state (original image + layers + settings) as a `.pfproject` JSON file that can be re-opened later to continue editing with full layer and undo history intact. No backend changes needed — `JSON.stringify` + a `Blob` download.

### F16 — Load from URL
An "Import from URL" input in the header that fetches a remote image via the Flask backend (to avoid CORS), converts it, and loads it as a new thumbnail. Requires a simple `/api/proxy-image?url=...` endpoint with URL validation.

### F17 — Export formats
Currently only PNG download is supported. Adding JPEG (with quality slider) and WebP export would cover more use cases. Both are available via `canvas.toBlob("image/jpeg", quality)` with no backend changes.

---

## UI / UX

### F18 — Keyboard shortcut reference panel
A `?` button or `Shift+?` shortcut that opens a modal listing all keyboard shortcuts. The data already exists in README.md — it just needs to be surfaced in the UI.

### F19 — Dark/light theme toggle
The app is currently dark-only. Adding a light theme as a CSS class on `<body>` toggled by a header button would broaden appeal. Requires duplicating ~20 CSS custom property values.

### F20 — Mobile / touch support
The canvas uses `mousedown`/`mousemove`/`mouseup` exclusively. Adding parallel `touchstart`/`touchmove`/`touchend` handlers (mapping `touch.clientX/Y` to the same logic) would make the app usable on tablets.

### F21 — Canvas ruler / grid overlay
Optional pixel rulers along the top/left edges of the canvas and a toggleable grid overlay. Useful for precise markup and alignment. Rendered on a separate overlay canvas positioned over `#canvas-wrap`.

### F22 — Undo history panel
A visual list of undo steps (e.g. "Brush stroke", "Crop applied", "AI inpaint") rather than just Undo/Redo buttons. Each step in `undoStack` could carry a `label` string pushed alongside the state snapshot.

### F23 — Customisable colour swatches
A row of saved swatches beneath the colour pickers, stored in `localStorage`. One-click to apply a swatch to the active colour input, double-click to replace it.

---

## Infrastructure & Developer Experience

### F24 — Hot reload in development
Add `watchdog` to dev dependencies and configure Flask in debug mode with auto-restart. For JS, a simple `browser-sync` or `live-server` invocation watching `app/static/` would avoid manual refreshes during development.

### F25 — Environment variable documentation
A `.env.example` file in the project root documenting every environment variable the app reads (`VERTEX_LOCATION`, `VERTEX_GENERATE_MODEL`, etc.), their defaults, and acceptable values.

### F26 — API documentation
A `/api/docs` route (or a `API.md` file) describing each endpoint's expected inputs, outputs, and error codes. Makes it much easier to test endpoints independently with `curl` or Postman, and gives Claude Code precise context when working on the backend.

### F27 — Rate limiting on AI endpoints
Add `Flask-Limiter` to prevent accidental or malicious runaway Vertex API usage. A simple per-IP limit (e.g. 20 requests/minute on generate endpoints) is enough for a local or small-team deployment.

```python
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

limiter = Limiter(get_remote_address, app=app, default_limits=["200/day"])

@app.post("/api/vertex/generate")
@limiter.limit("20/minute")
def vertex_generate_image():
    ...
```
