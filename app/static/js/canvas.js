// Canvas operations: render loop, zoom, image activation, crop/selection/resize,
// inpaint mask painting, and composite helpers.

import { state } from "./state.js";
import { canvas, ctx, dom } from "./dom.js";
// Circular with layers.js — ES modules handle this correctly via live bindings.
import { drawLayer, renderSelection, renderLayersPanel, pushUndo, updateHistoryButtons } from "./layers.js";
// Circular with ui.js — same reason.
import { getInpaintMaskMode } from "./ui.js";

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
        drawOverlayRect(
            { x: state.floatingSelection.x, y: state.floatingSelection.y, w: state.floatingSelection.w, h: state.floatingSelection.h },
            "#35d07f"
        );
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
        (state.activeTool === "select" || (state.activeTool === "inpaint" && getInpaintMaskMode() === "selection")) &&
        state.selectionRect && !state.floatingSelection
    ) {
        drawOverlayRect(state.selectionRect, "#35d07f");
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

export function replaceWithRasterCanvas(newCanvas) {
    const img = new Image();
    img.onload = () => {
        state.originalImage = img;
        canvas.width = img.width;
        canvas.height = img.height;

        state.activeBrushCanvas = document.createElement("canvas");
        state.activeBrushCanvas.width = img.width;
        state.activeBrushCanvas.height = img.height;
        state.activeBrushCtx = state.activeBrushCanvas.getContext("2d");

        state.layers = [];
        state.selectedLayerIndex = -1;
        clearCropState();
        clearSelectionState();
        render();
        renderLayersPanel();
        syncResizeInputs();
        pushUndo();
    };
    img.src = newCanvas.toDataURL("image/png");
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

export function createFloatingSelection(rect) {
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

    state.floatingSelection = { canvas: patch, x: clamped.x, y: clamped.y, w: clamped.w, h: clamped.h };
    state.selectionRect = { x: clamped.x, y: clamped.y, w: clamped.w, h: clamped.h };
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
    const source = buildCompositeCanvas();
    source.getContext("2d").clearRect(rect.x, rect.y, rect.w, rect.h);
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

export function createSelectionMaskBlob(rect) {
    return new Promise(resolve => {
        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = canvas.width;
        maskCanvas.height = canvas.height;
        const mctx = maskCanvas.getContext("2d");
        mctx.fillStyle = "#000";
        mctx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
        mctx.fillStyle = "#fff";
        mctx.fillRect(Math.floor(rect.x), Math.floor(rect.y), Math.floor(rect.w), Math.floor(rect.h));
        maskCanvas.toBlob(resolve, "image/png");
    });
}
