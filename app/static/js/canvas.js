// Canvas operations: render loop, zoom, image activation, crop/selection/resize,
// inpaint mask painting, and composite helpers.

import { state } from "./state.js";
import { canvas, ctx, dom } from "./dom.js";
// Circular with layers.js — ES modules handle this correctly via live bindings.
import { drawLayer, renderSelection, renderLayersPanel, pushUndo, updateHistoryButtons } from "./layers.js";
// Circular with ui.js — same reason.
import { getInpaintMaskMode, updateTransparencyScope } from "./ui.js";

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------
export function applyZoom() {
    canvas.style.width = Math.round(canvas.width * state.zoomLevel) + "px";
    canvas.style.height = Math.round(canvas.height * state.zoomLevel) + "px";
    canvas.style.maxWidth = "none";
    canvas.style.maxHeight = "none";
    dom.zoomLabel.textContent = Math.round(state.zoomLevel * 100) + "%";
}

export function setZoom(level) {
    if (level === "fit") {
        const availW = dom.canvasWrap.clientWidth - 24;
        const availH = window.innerHeight * 0.72;
        state.zoomLevel = Math.min(availW / canvas.width, availH / canvas.height);
    } else {
        state.zoomLevel = Math.max(state.MIN_ZOOM, Math.min(state.MAX_ZOOM, level));
    }
    applyZoom();
}

// ---------------------------------------------------------------------------
// Canvas activation
// ---------------------------------------------------------------------------
export function activateCanvas(img) {
    state.originalImage = img;
    canvas.width = img.width;
    canvas.height = img.height;

    state.activeBrushCanvas = document.createElement("canvas");
    state.activeBrushCanvas.width = img.width;
    state.activeBrushCanvas.height = img.height;
    state.activeBrushCtx = state.activeBrushCanvas.getContext("2d");

    state.inpaintMaskCanvas = document.createElement("canvas");
    state.inpaintMaskCanvas.width = img.width;
    state.inpaintMaskCanvas.height = img.height;
    state.inpaintMaskCtx = state.inpaintMaskCanvas.getContext("2d");
    state.inpaintMaskHasPaint = false;

    state.layers = [];
    state.selectedLayerIndex = -1;
    state.undoStack = [];
    state.redoStack = [];

    clearCropState();
    clearSelectionState();

    render();
    pushUndo();
    renderLayersPanel();
    updateHistoryButtons();
    syncResizeInputs();

    dom.emptyState.hidden = true;
    dom.canvasWrap.hidden = false;
    dom.canvasArea.classList.add("has-image");
    dom.downloadBtn.disabled = false;
    dom.copyBtn.disabled = false;
    dom.zoomControls.hidden = false;
    setZoom("fit");
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
export function render() {
    if (!state.originalImage) { return; }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (state.floatingSelection && state.selectionBackground) {
        ctx.drawImage(state.selectionBackground, 0, 0);
        ctx.drawImage(
            state.floatingSelection.canvas,
            Math.round(state.floatingSelection.x),
            Math.round(state.floatingSelection.y)
        );
        drawSelectionOutline(getActiveSelectionRect(), getActiveSelectionPath(), "#35d07f");
    } else if (state.eraseCanvas) {
        ctx.drawImage(state.eraseCanvas, 0, 0);
    } else {
        ctx.drawImage(state.originalImage, 0, 0);
        state.layers.forEach((layer, idx) => {
            drawLayer(ctx, layer);
            if (idx === state.selectedLayerIndex) { renderSelection(layer); }
        });
    }

    if (state.isDrawing && state.activeTool === "brush" && state.activeBrushCanvas) {
        ctx.drawImage(state.activeBrushCanvas, 0, 0);
    }

    if (state.activeTool === "crop" && state.cropRect) {
        drawOverlayRect(state.cropRect, "#ffd166");
    }

    if (
        (state.activeTool === "select" || state.activeTool === "transparency" ||
         (state.activeTool === "inpaint" && getInpaintMaskMode() === "selection")) &&
        state.selectionRect && !state.floatingSelection
    ) {
        drawSelectionOutline(state.selectionRect, state.selectionPath, "#35d07f");
    }

    if (state.lassoPoints && state.lassoPoints.length > 1) {
        drawOverlayPolyline(state.lassoPoints, false, "#35d07f");
    }

    if (state.activeTool === "transparency") {
        updateTransparencyScope();
    }

    if (
        (state.activeTool === "remove" || (state.activeTool === "inpaint" && getInpaintMaskMode() === "brush")) &&
        state.inpaintMaskHasPaint && state.inpaintMaskCanvas
    ) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.drawImage(state.inpaintMaskCanvas, 0, 0);
        ctx.restore();
    }

    if (state.activeTool === "eraser" && state.hoverPos) {
        drawEraserOutline(state.hoverPos);
    }
}

// ---------------------------------------------------------------------------
// Composite helpers
// ---------------------------------------------------------------------------
export function buildCompositeCanvas() {
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    const octx = out.getContext("2d");
    octx.drawImage(state.originalImage, 0, 0);
    state.layers.forEach(layer => drawLayer(octx, layer));
    return out;
}

export function replaceWithRasterCanvas(newCanvas, { keepSelection = false } = {}) {
    // A canvas is a valid drawImage source, so use it directly as the new base
    // image (synchronous; avoids a PNG encode/decode round trip). Callers must
    // pass a canvas they no longer modify.
    // keepSelection keeps the selection area (not a floating move) when the size is unchanged.
    const sameSize = newCanvas.width === canvas.width && newCanvas.height === canvas.height;
    state.originalImage = newCanvas;
    state.eraseCanvas = null;
    state.eraseCtx = null;
    state.eraseData = null;
    canvas.width = newCanvas.width;
    canvas.height = newCanvas.height;

    state.activeBrushCanvas = document.createElement("canvas");
    state.activeBrushCanvas.width = newCanvas.width;
    state.activeBrushCanvas.height = newCanvas.height;
    state.activeBrushCtx = state.activeBrushCanvas.getContext("2d");

    state.layers = [];
    state.selectedLayerIndex = -1;
    clearCropState();
    if (keepSelection && sameSize) { dropFloatingSelection(); } else { clearSelectionState(); }
    render();
    renderLayersPanel();
    syncResizeInputs();
    pushUndo();
}

export function flattenToBlob() {
    return new Promise(resolve => buildCompositeCanvas().toBlob(resolve, "image/png"));
}

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------
export function getCanvasPos(event) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (event.clientX - rect.left) * (canvas.width / rect.width),
        y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
}

export function normalizeRect(x1, y1, x2, y2) {
    return {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        w: Math.abs(x2 - x1),
        h: Math.abs(y2 - y1),
    };
}

export function clampRectToCanvas(rect) {
    if (!rect) { return null; }
    const x = Math.max(0, Math.floor(rect.x));
    const y = Math.max(0, Math.floor(rect.y));
    return {
        x,
        y,
        w: Math.min(Math.floor(rect.w), Math.max(0, canvas.width - x)),
        h: Math.min(Math.floor(rect.h), Math.max(0, canvas.height - y)),
    };
}

export function pointInRect(x, y, rect) {
    return rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

export function drawOverlayRect(rect, color) {
    if (!rect || rect.w <= 0 || rect.h <= 0) { return; }
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
}

function drawOverlayPolyline(points, closed, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) { ctx.lineTo(points[i].x, points[i].y); }
    if (closed) { ctx.closePath(); }
    ctx.stroke();
    ctx.restore();
}

function drawSelectionOutline(rect, path, color) {
    if (path && path.length > 2) { drawOverlayPolyline(path, true, color); } else { drawOverlayRect(rect, color); }
}

// ---------------------------------------------------------------------------
// Resize inputs sync
// ---------------------------------------------------------------------------
export function syncResizeInputs() {
    if (!state.originalImage) { return; }
    dom.resizeWidth.value = canvas.width;
    dom.resizeHeight.value = canvas.height;
    state.resizeAspectRatio = canvas.width / canvas.height;
}

// ---------------------------------------------------------------------------
// Crop state
// ---------------------------------------------------------------------------
export function clearCropState() {
    state.cropRect = null;
    dom.cropSizeLabel.textContent = "0 x 0";
}

export function updateCropLabel(rect) {
    dom.cropSizeLabel.textContent = rect ? Math.floor(rect.w) + " x " + Math.floor(rect.h) : "0 x 0";
}

export function applyCrop() {
    if (!state.originalImage || !state.cropRect) { return; }
    const rect = clampRectToCanvas(state.cropRect);
    if (!rect || rect.w < 2 || rect.h < 2) { return; }
    const source = buildCompositeCanvas();
    const out = document.createElement("canvas");
    out.width = rect.w;
    out.height = rect.h;
    out.getContext("2d").drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    replaceWithRasterCanvas(out);
}

// ---------------------------------------------------------------------------
// Selection state
// ---------------------------------------------------------------------------
export function clearSelectionState() {
    state.selectionRect = null;
    state.selectionPath = null;
    state.lassoPoints = null;
    state.floatingSelection = null;
    state.selectionBackground = null;
    state.isMovingSelection = false;
    dom.selectionSizeLabel.textContent = "0 x 0";
}

export function updateSelectionLabel(rect) {
    dom.selectionSizeLabel.textContent = rect ? Math.floor(rect.w) + " x " + Math.floor(rect.h) : "0 x 0";
}

export function getActiveSelectionRect() {
    if (state.floatingSelection) {
        return { x: state.floatingSelection.x, y: state.floatingSelection.y, w: state.floatingSelection.w, h: state.floatingSelection.h };
    }
    return state.selectionRect;
}

// Lasso polygon of the active selection in canvas coords, or null for a rectangle.
export function getActiveSelectionPath() {
    const f = state.floatingSelection;
    if (f) {
        return f.path ? f.path.map(p => ({ x: p.x + f.x, y: p.y + f.y })) : null;
    }
    return state.selectionPath;
}

export function hasActiveSelection() {
    const rect = clampRectToCanvas(getActiveSelectionRect());
    return !!rect && rect.w >= 1 && rect.h >= 1;
}

export function pointInSelection(x, y) {
    const f = state.floatingSelection;
    if (!f || !pointInRect(x, y, f)) { return false; }
    if (!f.mask) { return true; }
    const mx = Math.floor(x - f.x);
    const my = Math.floor(y - f.y);
    return mx >= 0 && my >= 0 && mx < f.w && my < f.h && f.mask[my * f.w + mx] === 1;
}

// Discard an unapplied move but keep the selected area where it was originally made,
// so other tools (e.g. Defringe) can be limited to it.
export function dropFloatingSelection() {
    const f = state.floatingSelection;
    if (!f) { return; }
    state.selectionRect = { x: f.origX, y: f.origY, w: f.w, h: f.h };
    state.selectionPath = f.path ? f.path.map(p => ({ x: p.x + f.origX, y: p.y + f.origY })) : null;
    state.floatingSelection = null;
    state.selectionBackground = null;
    state.isMovingSelection = false;
    updateSelectionLabel(state.selectionRect);
}

// Binary mask of pixels whose centres lie inside the polygon (even-odd rule).
function rasterizePolygon(path, w, h) {
    const mask = new Uint8Array(w * h);
    let minY = Infinity, maxY = -Infinity;
    for (const p of path) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(h - 1, Math.ceil(maxY));
    const n = path.length;
    const xs = [];
    for (let y = y0; y <= y1; y++) {
        const cy = y + 0.5;
        xs.length = 0;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const a = path[i];
            const b = path[j];
            if ((a.y > cy) !== (b.y > cy)) { xs.push(a.x + (cy - a.y) * (b.x - a.x) / (b.y - a.y)); }
        }
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) {
            const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
            const xb = Math.min(w - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
            for (let x = xa; x <= xb; x++) { mask[y * w + x] = 1; }
        }
    }
    return mask;
}

// Full-canvas mask (1 = selected) for the active selection, or null when nothing is selected.
export function buildSelectionMask() {
    const rect = clampRectToCanvas(getActiveSelectionRect());
    if (!rect || rect.w < 1 || rect.h < 1) { return null; }
    const w = canvas.width;
    const h = canvas.height;
    const path = getActiveSelectionPath();
    if (path) { return rasterizePolygon(path, w, h); }
    const mask = new Uint8Array(w * h);
    for (let y = rect.y; y < rect.y + rect.h; y++) { mask.fill(1, y * w + rect.x, y * w + rect.x + rect.w); }
    return mask;
}

function polygonBounds(path) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of path) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const x = Math.floor(minX);
    const y = Math.floor(minY);
    return { x, y, w: Math.ceil(maxX) - x, h: Math.ceil(maxY) - y };
}

export function createFloatingSelection(rect, path = null) {
    if (path) { return createFloatingLasso(path); }
    const clamped = clampRectToCanvas(rect);
    if (!clamped || clamped.w < 2 || clamped.h < 2) { return; }
    const source = buildCompositeCanvas();

    const patch = document.createElement("canvas");
    patch.width = clamped.w;
    patch.height = clamped.h;
    patch.getContext("2d").drawImage(source, clamped.x, clamped.y, clamped.w, clamped.h, 0, 0, clamped.w, clamped.h);

    state.selectionBackground = document.createElement("canvas");
    state.selectionBackground.width = canvas.width;
    state.selectionBackground.height = canvas.height;
    const bctx = state.selectionBackground.getContext("2d");
    bctx.drawImage(source, 0, 0);
    bctx.clearRect(clamped.x, clamped.y, clamped.w, clamped.h);

    state.floatingSelection = {
        canvas: patch, x: clamped.x, y: clamped.y, w: clamped.w, h: clamped.h,
        origX: clamped.x, origY: clamped.y, path: null, mask: null,
    };
    state.selectionRect = { x: clamped.x, y: clamped.y, w: clamped.w, h: clamped.h };
    state.selectionPath = null;
    updateSelectionLabel(state.selectionRect);
}

// Lasso: lift exactly the pixels inside the polygon (hard edge, so an unmoved
// selection recomposites to the original image).
function createFloatingLasso(path) {
    const w = canvas.width;
    const h = canvas.height;
    const bounds = clampRectToCanvas(polygonBounds(path));
    if (!bounds || bounds.w < 2 || bounds.h < 2) { return; }
    const full = rasterizePolygon(path, w, h);

    const mask = new Uint8Array(bounds.w * bounds.h);
    let count = 0;
    for (let y = 0; y < bounds.h; y++) {
        for (let x = 0; x < bounds.w; x++) {
            if (full[(y + bounds.y) * w + x + bounds.x]) { mask[y * bounds.w + x] = 1; count++; }
        }
    }
    if (count === 0) { return; }

    const source = buildCompositeCanvas();
    const sctx = source.getContext("2d");
    const all = sctx.getImageData(0, 0, w, h);
    const patchData = new ImageData(bounds.w, bounds.h);
    for (let y = 0; y < bounds.h; y++) {
        for (let x = 0; x < bounds.w; x++) {
            if (!mask[y * bounds.w + x]) { continue; }
            const si = ((y + bounds.y) * w + x + bounds.x) * 4;
            const di = (y * bounds.w + x) * 4;
            patchData.data[di] = all.data[si];
            patchData.data[di + 1] = all.data[si + 1];
            patchData.data[di + 2] = all.data[si + 2];
            patchData.data[di + 3] = all.data[si + 3];
            all.data[si + 3] = 0;
        }
    }
    const patch = document.createElement("canvas");
    patch.width = bounds.w;
    patch.height = bounds.h;
    patch.getContext("2d").putImageData(patchData, 0, 0);

    sctx.putImageData(all, 0, 0);
    state.selectionBackground = source;

    const relPath = path.map(p => ({ x: p.x - bounds.x, y: p.y - bounds.y }));
    state.floatingSelection = {
        canvas: patch, x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h,
        origX: bounds.x, origY: bounds.y, path: relPath, mask,
    };
    state.selectionRect = { ...bounds };
    state.selectionPath = null;
    updateSelectionLabel(state.selectionRect);
}

export function applySelectionMove() {
    if (!state.floatingSelection || !state.selectionBackground) { return; }
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    const octx = out.getContext("2d");
    octx.drawImage(state.selectionBackground, 0, 0);
    octx.drawImage(state.floatingSelection.canvas, Math.round(state.floatingSelection.x), Math.round(state.floatingSelection.y));
    replaceWithRasterCanvas(out);
}

export function deleteSelection() {
    if (!state.originalImage) { return; }
    const rect = clampRectToCanvas(getActiveSelectionRect());
    if (!rect || rect.w < 1 || rect.h < 1) { return; }
    const path = getActiveSelectionPath();
    const source = buildCompositeCanvas();
    const sctx = source.getContext("2d");
    if (path) {
        const mask = buildSelectionMask();
        const img = sctx.getImageData(0, 0, source.width, source.height);
        for (let p = 0; p < mask.length; p++) {
            if (mask[p]) { img.data[p * 4 + 3] = 0; }
        }
        sctx.putImageData(img, 0, 0);
    } else {
        sctx.clearRect(rect.x, rect.y, rect.w, rect.h);
    }
    replaceWithRasterCanvas(source);
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------
export function applyResize() {
    if (!state.originalImage) { return; }
    const w = parseInt(dom.resizeWidth.value, 10);
    const h = parseInt(dom.resizeHeight.value, 10);
    if (!w || !h || w < 1 || h < 1) { return; }
    const source = buildCompositeCanvas();
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const octx = out.getContext("2d");
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";
    octx.drawImage(source, 0, 0, w, h);
    replaceWithRasterCanvas(out);
}

// ---------------------------------------------------------------------------
// Inpaint mask painting
// ---------------------------------------------------------------------------
export function clearInpaintMask() {
    if (!state.inpaintMaskCtx || !state.inpaintMaskCanvas) { return; }
    state.inpaintMaskCtx.clearRect(0, 0, state.inpaintMaskCanvas.width, state.inpaintMaskCanvas.height);
    state.inpaintMaskHasPaint = false;
    render();
}

export function paintInpaintMaskDot(x, y, brushSize) {
    if (!state.inpaintMaskCtx) { return; }
    const radius = (brushSize ?? parseInt(dom.inpaintBrushSize.value, 10)) / 2;
    state.inpaintMaskCtx.beginPath();
    state.inpaintMaskCtx.arc(x, y, radius, 0, Math.PI * 2);
    state.inpaintMaskCtx.fillStyle = "#fff";
    state.inpaintMaskCtx.fill();
    state.inpaintMaskHasPaint = true;
}

export function paintInpaintMaskStroke(x1, y1, x2, y2, brushSize) {
    if (!state.inpaintMaskCtx) { return; }
    state.inpaintMaskCtx.beginPath();
    state.inpaintMaskCtx.moveTo(x1, y1);
    state.inpaintMaskCtx.lineTo(x2, y2);
    state.inpaintMaskCtx.strokeStyle = "#fff";
    state.inpaintMaskCtx.lineWidth = brushSize ?? parseInt(dom.inpaintBrushSize.value, 10);
    state.inpaintMaskCtx.lineCap = "round";
    state.inpaintMaskCtx.lineJoin = "round";
    state.inpaintMaskCtx.stroke();
    state.inpaintMaskHasPaint = true;
}

// ---------------------------------------------------------------------------
// Magic wand flood-select (F6)
// ---------------------------------------------------------------------------
export function wandFloodSelect(px, py, tolerance) {
    const x = Math.floor(px);
    const y = Math.floor(py);
    const w = canvas.width;
    const h = canvas.height;
    if (x < 0 || x >= w || y < 0 || y >= h) { return; }

    const composite = buildCompositeCanvas();
    const source = composite.getContext("2d").getImageData(0, 0, w, h).data;

    const seed = (y * w + x) * 4;
    const startR = source[seed];
    const startG = source[seed + 1];
    const startB = source[seed + 2];
    const startA = source[seed + 3];

    const visited = new Uint8Array(w * h);
    const stack = [x + y * w];
    visited[x + y * w] = 1;
    let minX = x, maxX = x, minY = y, maxY = y;

    while (stack.length > 0) {
        const p = stack.pop();
        const cx = p % w;
        const cy = (p - cx) / w;
        const i = p * 4;
        const dr = source[i] - startR;
        const dg = source[i + 1] - startG;
        const db = source[i + 2] - startB;
        const da = source[i + 3] - startA;
        if (Math.sqrt(dr * dr + dg * dg + db * db + da * da) <= tolerance) {
            if (cx < minX) { minX = cx; }
            if (cx > maxX) { maxX = cx; }
            if (cy < minY) { minY = cy; }
            if (cy > maxY) { maxY = cy; }
            if (cx > 0 && !visited[p - 1]) { visited[p - 1] = 1; stack.push(p - 1); }
            if (cx < w - 1 && !visited[p + 1]) { visited[p + 1] = 1; stack.push(p + 1); }
            if (cy > 0 && !visited[p - w]) { visited[p - w] = 1; stack.push(p - w); }
            if (cy < h - 1 && !visited[p + w]) { visited[p + w] = 1; stack.push(p + w); }
        }
    }

    const bboxW = maxX - minX + 1;
    const bboxH = maxY - minY + 1;
    if (bboxW < 2 || bboxH < 2) { return; }
    createFloatingSelection({ x: minX, y: minY, w: bboxW, h: bboxH });
    render();
}

export function createInpaintBrushMaskBlob() {
    return new Promise(resolve => {
        // Composite onto a black background so Vertex receives black=preserve, white=inpaint.
        // Without this, unpainted areas are transparent, which gives undefined/wrong results.
        const out = document.createElement("canvas");
        out.width = state.inpaintMaskCanvas.width;
        out.height = state.inpaintMaskCanvas.height;
        const octx = out.getContext("2d");
        octx.fillStyle = "#000";
        octx.fillRect(0, 0, out.width, out.height);
        octx.drawImage(state.inpaintMaskCanvas, 0, 0);
        out.toBlob(resolve, "image/png");
    });
}

// White = inpaint, black = keep. Follows the active selection's shape (rectangle or lasso).
export function createSelectionMaskBlob() {
    return new Promise(resolve => {
        const w = canvas.width;
        const h = canvas.height;
        const mask = buildSelectionMask();
        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = w;
        maskCanvas.height = h;
        const mctx = maskCanvas.getContext("2d");
        const img = mctx.createImageData(w, h);
        for (let p = 0; p < w * h; p++) {
            const v = mask && mask[p] ? 255 : 0;
            img.data[p * 4] = v;
            img.data[p * 4 + 1] = v;
            img.data[p * 4 + 2] = v;
            img.data[p * 4 + 3] = 255;
        }
        mctx.putImageData(img, 0, 0);
        maskCanvas.toBlob(resolve, "image/png");
    });
}

// ---------------------------------------------------------------------------
// Eraser: strokes edit a flattened working copy, committed as one undo step.
// ---------------------------------------------------------------------------
export const ERASER_SIZES = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100];

export function getEraserSize() {
    return ERASER_SIZES[parseInt(dom.eraserSize.value, 10)] ?? 10;
}

// Hard-edge stamp centre: pixel centre for odd sizes, pixel corner for even sizes,
// so size 1 is exactly the pixel under the cursor and size 2 is a 2x2 block.
function eraserCentre(pos, size) {
    return size % 2 === 1
        ? { x: Math.floor(pos.x) + 0.5, y: Math.floor(pos.y) + 0.5 }
        : { x: Math.round(pos.x), y: Math.round(pos.y) };
}

const _offsetCache = new Map();
function eraserOffsets(size) {
    if (_offsetCache.has(size)) { return _offsetCache.get(size); }
    // Offsets of pixels (relative to floor(centre - r)) whose centres lie inside the circle.
    const r = size / 2;
    const span = Math.ceil(size) + 1;
    const c = size % 2 === 1 ? 0.5 : 0;
    const offsets = [];
    for (let j = -span; j <= span; j++) {
        for (let i = -span; i <= span; i++) {
            const dx = i + 0.5 - c;
            const dy = j + 0.5 - c;
            if (dx * dx + dy * dy <= r * r) { offsets.push([i, j]); }
        }
    }
    _offsetCache.set(size, offsets);
    return offsets;
}

function hardStamp(pos, size, dirty) {
    const centre = eraserCentre(pos, size);
    const bx = Math.floor(centre.x);
    const by = Math.floor(centre.y);
    const w = state.eraseCanvas.width;
    const h = state.eraseCanvas.height;
    const d = state.eraseData.data;
    for (const [i, j] of eraserOffsets(size)) {
        const x = bx + i;
        const y = by + j;
        if (x < 0 || y < 0 || x >= w || y >= h) { continue; }
        d[(y * w + x) * 4 + 3] = 0;
        if (x < dirty.x0) { dirty.x0 = x; }
        if (y < dirty.y0) { dirty.y0 = y; }
        if (x > dirty.x1) { dirty.x1 = x; }
        if (y > dirty.y1) { dirty.y1 = y; }
    }
}

function eraseSegment(from, to) {
    const size = getEraserSize();
    if (dom.eraserSoft.checked) {
        const c = state.eraseCtx;
        c.save();
        c.globalCompositeOperation = "destination-out";
        c.lineCap = "round";
        c.lineJoin = "round";
        c.lineWidth = size;
        c.beginPath();
        c.moveTo(from.x, from.y);
        c.lineTo(to.x + 0.01, to.y);
        c.stroke();
        c.restore();
        // Keep the pixel buffer in sync in case the user toggles mode mid-image.
        state.eraseData = c.getImageData(0, 0, state.eraseCanvas.width, state.eraseCanvas.height);
        return;
    }
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const spacing = Math.max(0.5, size / 4);
    const steps = Math.max(1, Math.ceil(dist / spacing));
    const dirty = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        hardStamp({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, size, dirty);
    }
    if (dirty.x1 >= dirty.x0) {
        state.eraseCtx.putImageData(state.eraseData, 0, 0, dirty.x0, dirty.y0, dirty.x1 - dirty.x0 + 1, dirty.y1 - dirty.y0 + 1);
    }
}

export function startErase(pos) {
    state.eraseCanvas = buildCompositeCanvas();
    state.eraseCtx = state.eraseCanvas.getContext("2d", { willReadFrequently: true });
    state.eraseData = state.eraseCtx.getImageData(0, 0, state.eraseCanvas.width, state.eraseCanvas.height);
    state.eraseLast = pos;
    eraseSegment(pos, pos);
    render();
}

export function continueErase(pos) {
    if (!state.eraseCanvas || !state.eraseLast) { return; }
    eraseSegment(state.eraseLast, pos);
    state.eraseLast = pos;
    render();
}

export function endErase() {
    if (!state.eraseCanvas || !state.eraseLast) { return; }
    state.eraseLast = null;
    replaceWithRasterCanvas(state.eraseCanvas);
}

function drawEraserOutline(pos) {
    const size = getEraserSize();
    const soft = dom.eraserSoft.checked;
    const centre = soft ? pos : eraserCentre(pos, size);
    const lw = 1 / state.zoomLevel;
    ctx.save();
    ctx.lineWidth = lw;
    ctx.beginPath();
    if (!soft && size <= 2) {
        ctx.rect(Math.floor(centre.x - size / 2), Math.floor(centre.y - size / 2), size, size);
    } else {
        ctx.arc(centre.x, centre.y, size / 2, 0, Math.PI * 2);
    }
    ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
    ctx.stroke();
    ctx.setLineDash([3 * lw, 3 * lw]);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
    ctx.stroke();
    ctx.restore();
}
