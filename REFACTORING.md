# PixelForge — Refactoring Recommendations

These recommendations are organised into three phases by effort and risk. Phase 1 items have the highest return per hour spent and are safe to pick up independently. Later phases build on top of them.

---

## Phase 1 — Quick wins (low risk, immediate payoff) ✅ Complete

### ~~1.1 Split `markup.js` into ES modules~~ ✅

`markup.js` is 2,500+ lines inside a single IIFE. This is the single biggest drag on Claude Code token usage because every read/edit loads the entire file. Splitting it into focused modules means you only need to load the file relevant to the change you're making.

Suggested split:

```
app/static/js/
  api.js          # fetch wrappers: runVertexGenerate, runVertexRefine, runVertexInpaint, runAiBackgroundRemoval
  canvas.js       # activateCanvas, render, buildCompositeCanvas, replaceWithRasterCanvas, zoom helpers
  layers.js       # layer CRUD, renderLayersPanel, undo/redo stack
  tools/
    brush.js
    fill.js
    text.js
    shapes.js
    crop.js
    select.js
    transparency.js
  thumbs.js       # appendThumbSlot, selectThumbSlot, saveCurrentThumbState, deleteActiveThumb
  ui.js           # showTopNotice, setTool, updateToolSettingsForActiveTool, panel visibility
  markup.js       # entry point — wires everything together, event listeners
```

Add a `<script type="module">` tag in `index.html` and use `import/export`. No build tool is required for local dev (Chrome/Firefox support ES modules natively).

**Token savings:** reading `api.js` (~120 lines) instead of `markup.js` (~2,500 lines) is a ~95% reduction when working on AI features.

---

### ~~1.2 Replace `var` with `const`/`let`~~ ✅

The entire codebase uses ES5 `var`. Function-scoped variables make it harder to spot bugs and reduce editor/linter signal. Switch to `const` by default, `let` where reassignment is needed. This also improves Claude Code's ability to reason about scope correctly.

---

### ~~1.3 Replace `print(flush=True)` with Python `logging`~~ ✅

`main.py` uses raw `print` calls. Python's `logging` module gives severity levels, timestamps, and easy redirection without code changes.

```python
# Replace this pattern:
print(f"[vertex/generate] got {len(raw)} predictions back", flush=True)

# With:
import logging
logger = logging.getLogger(__name__)
logger.info("[vertex/generate] got %d predictions back", len(raw))
```

Configure at app startup with `logging.basicConfig(level=logging.INFO)`.

---

### ~~1.4 Add upload size and MIME validation to all API endpoints~~ ✅

Currently any file can be uploaded. Adding limits protects the server and makes error messages clearer.

```python
MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MB

def _read_validated_image(file_storage):
    data = file_storage.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError("Image too large (20 MB max)")
    if not data[:4] in (b'\x89PNG', b'\xff\xd8\xff'):  # PNG or JPEG magic
        raise ValueError("Unsupported image format")
    return data
```

---

### ~~1.5 Fix indentation inconsistency in `render()`~~ ✅

There is a stray indent in `markup.js` around line 1071:

```javascript
        if ((activeTool === "select" ...) && selectionRect && !floatingSelection) {
            drawOverlayRect(selectionRect, "#35d07f");
        }
            if ((activeTool === "inpaint" ...) {   // ← over-indented by 4 spaces
```

This is harmless but confusing for AI context parsing.

---

### ~~1.6 Extract tool config into a data table~~ ✅

`updateToolSettingsForActiveTool` has 12 identical if-else branches. Replace with a lookup object so adding a new tool means editing one place, not three:

```javascript
const TOOL_CONFIG = {
  brush:        { panel: brushSettings,        title: "Brush controls",          desc: "Draw freehand strokes on a new layer." },
  fill:         { panel: fillSettings,         title: "Fill controls",           desc: "Fill contiguous pixels by color tolerance." },
  text:         { panel: textSettings,         title: "Text controls",           desc: "Click anywhere on the image to place text." },
  // ...
};

function updateToolSettingsForActiveTool() {
  toolPanels.forEach(p => setPanelVisible(p, false));
  const config = TOOL_CONFIG[activeTool];
  if (!config) return;
  setPanelVisible(config.panel, true);
  toolContextTitle.textContent = config.title;
  toolContextDescription.textContent = config.desc;
  animateContextRefresh();
  canvas.style.cursor = config.cursor ?? "crosshair";
}
```

---

## Phase 2 — Structural improvements (medium effort, high maintainability gain) ✅ Complete

### ~~2.1 Replace raw `struct`/`zlib` PNG generation with Pillow~~ ✅

`_make_white_mask_b64` in `main.py` generates a PNG by manually packing IHDR/IDAT/IEND chunks. This is fragile, hard to read, and unnecessary — `rembg` already pulls in `Pillow` as a dependency:

```python
from PIL import Image
import io, base64

def _make_white_mask_b64(image_bytes: bytes) -> str:
    src = Image.open(io.BytesIO(image_bytes))
    mask = Image.new("RGB", src.size, (255, 255, 255))
    buf = io.BytesIO()
    mask.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()
```

Pillow is already present — no new dependency required.

---

### ~~2.2 Use `drawLayer` dispatch table instead of if-else chain~~ ✅

`drawLayer` and `getLayerBounds` both contain long if-chains on `layer.type`. Replace with a dispatch map:

```javascript
const LAYER_RENDERERS = {
  brush:   drawBrushLayer,
  text:    drawTextLayer,
  line:    drawLineLayer,
  arrow:   drawArrowLayer,
  rect:    drawRectLayer,
  ellipse: drawEllipseLayer,
};

function drawLayer(c, layer) {
  const fn = LAYER_RENDERERS[layer.type];
  if (fn) fn(c, layer);
}
```

Adding a new layer type then requires only one registration, not edits in three places.

---

### ~~2.3 Consolidate duplicated thumbnail-append logic in `runVertexGenerate` / `runVertexRefine`~~ ✅

Both functions have identical ~15-line blocks for saving state, appending slots, and activating the first image. Extract to a shared helper:

```javascript
async function applyGeneratedImages(images, successMsg) {
    saveCurrentThumbState();
    let firstNewIndex = -1;
    images.forEach(b64 => {
        const idx = appendThumbSlot("data:image/png;base64," + b64);
        if (firstNewIndex < 0) firstNewIndex = idx;
    });
    const firstImg = await loadBase64AsImage(images[0]);
    thumbSlots.forEach(s => s.el.classList.remove("selected"));
    activeThumbIndex = firstNewIndex;
    activateCanvas(firstImg);
    thumbSlots[firstNewIndex].el.classList.add("selected");
    updateThumbDeleteBtn();
    showTopNotice(successMsg, "success", 3000);
}
```

---

### ~~2.4 Pin exact dependency versions using a lock file~~ ✅

`requirements.txt` uses glob versions (`Flask==3.1.*`). This means a pip install today could differ from one in three months. Add `pip-tools` to dev dependencies and commit `requirements.lock`:

```bash
pip install pip-tools
pip-compile requirements.txt -o requirements.lock
```

In the Dockerfile, replace:
```dockerfile
RUN pip install --no-cache-dir -r requirements.txt
```
with:
```dockerfile
RUN pip install --no-cache-dir -r requirements.lock
```

---

### ~~2.5 Add a `/health` endpoint~~ ✅

Useful for Docker health checks, load balancers, and monitoring:

```python
@app.get("/health")
def health():
    return jsonify({"status": "ok"})
```

Add to `docker-compose.yml`:
```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:5000/health"]
  interval: 30s
  timeout: 5s
  retries: 3
```

---

### ~~2.6 Standardise API error responses~~ ✅

Currently some endpoints return `{"error": "..."}` with various status codes, and the error extraction in the JS client is inconsistent. Define a single helper:

```python
def api_error(message: str, status: int = 400):
    return jsonify({"error": message}), status
```

And on the frontend, a single `extractApiError(response)` function instead of repeated try/catch blocks in each `run*` function.

---

## Phase 3 — Tooling & architecture (larger investment, production-ready)

### 3.1 Add a JavaScript bundler (esbuild)

Once the JS is split into modules (Phase 1.1), add `esbuild` to bundle for production. This enables:
- Tree-shaking of unused code
- Minification (smaller payload)
- Source maps for debugging
- A single `<script>` tag in HTML

`esbuild` is a single binary with zero config needed for a simple bundle. A one-line build command:

```bash
esbuild app/static/js/markup.js --bundle --minify --outfile=app/static/js/bundle.js
```

---

### ~~3.2 Add Python type hints to `main.py`~~ ✅

Flask 3.x and Python 3.12 support full type annotations. Annotating the Vertex helpers makes them much easier for AI assistance to reason about correctly:

```python
def _vertex_predict(
    model_name: str,
    instances: list[dict],
    parameters: dict,
    timeout: int = 300,
) -> dict:
    ...
```

---

### ~~3.3 Move Vertex configuration to a dataclass~~ ✅

The four global `VERTEX_*` constants and credential loading logic could be grouped into a `VertexConfig` dataclass, making it easier to test and mock:

```python
from dataclasses import dataclass

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
            credentials_path=Path(os.getenv("VERTEX_CREDENTIALS_PATH", ...)),
        )
```

---

### 3.4 Add linting

**Python:** add `ruff` (fast, zero-config):
```bash
pip install ruff
ruff check app/
```

**JavaScript:** add `eslint` with a minimal config once the code is in ES module format:
```bash
npm init -y && npm install -D eslint
npx eslint --init
```

Both can run as a pre-commit hook to catch issues before they reach context.

---

## Summary table

| Item | File(s) affected | Effort | Token savings | Status |
|------|-----------------|--------|---------------|--------|
| 1.1 Split markup.js into modules | markup.js | High | Very high | ✅ Done |
| 1.2 const/let | markup.js | Low | Low | ✅ Done |
| 1.3 Python logging | main.py | Low | Low | ✅ Done |
| 1.4 Upload validation | main.py | Low | Medium | ✅ Done |
| 1.5 Fix render() indent | markup.js | Trivial | Low | ✅ Done |
| 1.6 Tool config table | markup.js | Low | Medium | ✅ Done |
| 2.1 Pillow for mask gen | main.py | Low | Low | ✅ Done |
| 2.2 drawLayer dispatch | layers.js | Medium | Medium | ✅ Done |
| 2.3 applyGeneratedImages | api.js | Low | Low | ✅ Done |
| 2.4 Pin versions | requirements.txt | Low | Low | ✅ Done |
| 2.5 Health endpoint | main.py | Trivial | Low | ✅ Done |
| 2.6 Standardise errors | main.py + api.js | Medium | Medium | ✅ Done |
| 3.1 esbuild | tooling | Medium | High | |
| 3.2 Type hints | main.py | Medium | Medium | ✅ Done |
| 3.3 VertexConfig dataclass | main.py | Medium | Medium | ✅ Done |
| 3.4 Linting | tooling | Medium | Medium | |
