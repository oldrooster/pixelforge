// Layer rendering, layer panel, undo/redo, flood fill, transparency fill, shape creation.
// Circular dependency with canvas.js (render, buildCompositeCanvas) is intentional
// and handled correctly by ES modules via live bindings.

import { state } from "./state.js";
import { canvas, ctx, dom } from "./dom.js";
import { render, buildCompositeCanvas, replaceWithRasterCanvas, syncResizeInputs } from "./canvas.js";

// ---------------------------------------------------------------------------
// Drawing primitives
// ---------------------------------------------------------------------------
function drawArrow(c, x1, y1, x2, y2, color, width) {
    const headLen = Math.max(width * 4, 10);
    const angle = Math.atan2(y2 - y1, x2 - x1);

    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.strokeStyle = color;
    c.lineWidth = width;
    c.lineCap = "round";
    c.stroke();

    c.beginPath();
    c.moveTo(x2, y2);
    c.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
    c.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
    c.closePath();
    c.fillStyle = color;
    c.fill();
}

function drawBrushLayer(c, layer) {
    const bCanvas = document.createElement("canvas");
    bCanvas.width = layer.imageData.width;
    bCanvas.height = layer.imageData.height;
    bCanvas.getContext("2d").putImageData(layer.imageData, 0, 0);
    c.drawImage(bCanvas, 0, 0);
}

function drawTextLayer(c, layer) {
    c.fillStyle = layer.color;
    c.font = layer.fontSize + "px " + layer.fontFamily;
    c.textBaseline = "top";
    c.fillText(layer.text, layer.x, layer.y);
}

function drawLineLayer(c, layer) {
    c.beginPath();
    c.moveTo(layer.x1, layer.y1);
    c.lineTo(layer.x2, layer.y2);
    c.strokeStyle = layer.color;
    c.lineWidth = layer.lineWidth;
    c.lineCap = "round";
    c.stroke();
}

function drawArrowLayer(c, layer) {
    drawArrow(c, layer.x1, layer.y1, layer.x2, layer.y2, layer.color, layer.lineWidth);
}

function drawRectLayer(c, layer) {
    if (layer.fill) {
        c.fillStyle = layer.fillColor;
        c.fillRect(layer.x, layer.y, layer.w, layer.h);
    }
    c.strokeStyle = layer.color;
    c.lineWidth = layer.lineWidth;
    c.strokeRect(layer.x, layer.y, layer.w, layer.h);
}

function drawEllipseLayer(c, layer) {
    c.beginPath();
    c.ellipse(layer.cx, layer.cy, Math.abs(layer.rx), Math.abs(layer.ry), 0, 0, Math.PI * 2);
    if (layer.fill) {
        c.fillStyle = layer.fillColor;
        c.fill();
    }
    c.strokeStyle = layer.color;
    c.lineWidth = layer.lineWidth;
    c.stroke();
}

const LAYER_RENDERERS = {
    brush:   drawBrushLayer,
    text:    drawTextLayer,
    line:    drawLineLayer,
    arrow:   drawArrowLayer,
    rect:    drawRectLayer,
    ellipse: drawEllipseLayer,
};

export function drawLayer(c, layer) {
    c.save();
    const fn = LAYER_RENDERERS[layer.type];
    if (fn) { fn(c, layer); }
    c.restore();
}

export function getLayerBounds(layer) {
    if (layer.type === "brush") { return null; }
    if (layer.type === "text") {
        ctx.save();
        ctx.font = layer.fontSize + "px " + layer.fontFamily;
        const width = ctx.measureText(layer.text).width;
        ctx.restore();
        return { x: layer.x, y: layer.y, w: width, h: layer.fontSize * 1.2 };
    }
    if (layer.type === "line" || layer.type === "arrow") {
        return {
            x: Math.min(layer.x1, layer.x2),
            y: Math.min(layer.y1, layer.y2),
            w: Math.abs(layer.x2 - layer.x1),
            h: Math.abs(layer.y2 - layer.y1),
        };
    }
    if (layer.type === "rect") {
        return { x: layer.x, y: layer.y, w: layer.w, h: layer.h };
    }
    if (layer.type === "ellipse") {
        return {
            x: layer.cx - Math.abs(layer.rx),
            y: layer.cy - Math.abs(layer.ry),
            w: Math.abs(layer.rx) * 2,
            h: Math.abs(layer.ry) * 2,
        };
    }
    return null;
}

export function hitTestLayers(x, y) {
    const pad = 6;
    for (let i = state.layers.length - 1; i >= 0; i--) {
        const bounds = getLayerBounds(state.layers[i]);
        if (!bounds) { continue; }
        if (x >= bounds.x - pad && x <= bounds.x + bounds.w + pad && y >= bounds.y - pad && y <= bounds.y + bounds.h + pad) {
            return i;
        }
    }
    return -1;
}

export function renderSelection(layer) {
    const bounds = getLayerBounds(layer);
    if (!bounds) { return; }
    ctx.save();
    ctx.strokeStyle = "#2f9bff";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(bounds.x - 3, bounds.y - 3, bounds.w + 6, bounds.h + 6);
    ctx.setLineDash([]);
    ctx.restore();
}

// ---------------------------------------------------------------------------
// Shape layer factory
// ---------------------------------------------------------------------------
export function createShapeLayer(x1, y1, x2, y2) {
    const shapeType = dom.shapeTypeRadios.find(r => r.checked)?.value ?? "line";
    const stroke = dom.shapeColor.value;
    const width = parseInt(dom.strokeSize.value, 10);
    const fill = dom.shapeFillEnabled.checked;
    const fillCol = dom.shapeFillColor.value;

    if (shapeType === "line") {
        return { type: "line", x1, y1, x2, y2, color: stroke, lineWidth: width };
    }
    if (shapeType === "arrow") {
        return { type: "arrow", x1, y1, x2, y2, color: stroke, lineWidth: width };
    }
    if (shapeType === "rect") {
        return {
            type: "rect",
            x: Math.min(x1, x2), y: Math.min(y1, y2),
            w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
            color: stroke, lineWidth: width, fill, fillColor: fillCol,
        };
    }
    if (shapeType === "ellipse") {
        return {
            type: "ellipse",
            cx: (x1 + x2) / 2, cy: (y1 + y2) / 2,
            rx: Math.abs(x2 - x1) / 2, ry: Math.abs(y2 - y1) / 2,
            color: stroke, lineWidth: width, fill, fillColor: fillCol,
        };
    }
    return null;
}

// ---------------------------------------------------------------------------
// Layer panel
// ---------------------------------------------------------------------------
let _dragSrcIndex = -1;

export function renderLayersPanel() {
    dom.layersPanel.innerHTML = "";

    if (state.layers.length === 0) {
        dom.layersPanel.innerHTML = "<div class='hint'>No layers yet</div>";
        return;
    }

    state.layers.forEach((layer, index) => {
        const item = document.createElement("div");
        item.className = "layer-item" + (index === state.selectedLayerIndex ? " selected" : "");
        item.draggable = true;

        // Drag-to-reorder (F3)
        item.addEventListener("dragstart", e => {
            _dragSrcIndex = index;
            e.dataTransfer.effectAllowed = "move";
            item.classList.add("layer-dragging");
        });
        item.addEventListener("dragend", () => item.classList.remove("layer-dragging"));
        item.addEventListener("dragover", e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            item.classList.add("layer-drag-over");
        });
        item.addEventListener("dragleave", () => item.classList.remove("layer-drag-over"));
        item.addEventListener("drop", e => {
            e.preventDefault();
            item.classList.remove("layer-drag-over");
            if (_dragSrcIndex < 0 || _dragSrcIndex === index) { return; }
            const moved = state.layers.splice(_dragSrcIndex, 1)[0];
            state.layers.splice(index, 0, moved);
            state.selectedLayerIndex = index;
            _dragSrcIndex = -1;
            render();
            renderLayersPanel();
            pushUndo();
        });

        const title = document.createElement("span");
        title.className = "layer-title";
        title.textContent = layer.type === "brush" ? "Brush"
            : layer.type === "text" ? "Text: " + layer.text.substring(0, 14)
            : layer.type;
        item.appendChild(title);

        const actions = document.createElement("div");
        actions.className = "layer-actions";

        // Merge down (F4) — rasterise this layer + the one below it
        if (index > 0) {
            const merge = document.createElement("button");
            merge.className = "layer-btn";
            merge.textContent = "Merge↓";
            merge.title = "Merge down";
            merge.addEventListener("click", event => {
                event.stopPropagation();
                const w = canvas.width;
                const h = canvas.height;
                const tmp = document.createElement("canvas");
                tmp.width = w; tmp.height = h;
                const tc = tmp.getContext("2d");
                drawLayer(tc, state.layers[index - 1]);
                drawLayer(tc, state.layers[index]);
                const merged = { type: "brush", imageData: tc.getImageData(0, 0, w, h) };
                state.layers.splice(index - 1, 2, merged);
                state.selectedLayerIndex = index - 1;
                render();
                renderLayersPanel();
                pushUndo();
            });
            actions.appendChild(merge);
        }

        const up = document.createElement("button");
        up.className = "layer-btn";
        up.textContent = "Up";
        up.disabled = index === 0;
        up.addEventListener("click", event => {
            event.stopPropagation();
            if (index === 0) { return; }
            [state.layers[index - 1], state.layers[index]] = [state.layers[index], state.layers[index - 1]];
            state.selectedLayerIndex = index - 1;
            render();
            renderLayersPanel();
            pushUndo();
        });
        actions.appendChild(up);

        const down = document.createElement("button");
        down.className = "layer-btn";
        down.textContent = "Dn";
        down.disabled = index === state.layers.length - 1;
        down.addEventListener("click", event => {
            event.stopPropagation();
            if (index >= state.layers.length - 1) { return; }
            [state.layers[index + 1], state.layers[index]] = [state.layers[index], state.layers[index + 1]];
            state.selectedLayerIndex = index + 1;
            render();
            renderLayersPanel();
            pushUndo();
        });
        actions.appendChild(down);

        const del = document.createElement("button");
        del.className = "layer-btn";
        del.textContent = "Del";
        del.addEventListener("click", event => {
            event.stopPropagation();
            state.layers.splice(index, 1);
            state.selectedLayerIndex = -1;
            render();
            renderLayersPanel();
            pushUndo();
        });
        actions.appendChild(del);

        item.appendChild(actions);
        item.addEventListener("click", () => {
            state.selectedLayerIndex = index;
            render();
            renderLayersPanel();
        });

        dom.layersPanel.appendChild(item);
    });
}

// ---------------------------------------------------------------------------
// Flatten all layers (F4)
// ---------------------------------------------------------------------------
export function flattenAllLayers() {
    if (!state.originalImage || state.layers.length === 0) { return; }
    const composite = buildCompositeCanvas();
    const w = composite.width;
    const h = composite.height;
    const imageData = composite.getContext("2d").getImageData(0, 0, w, h);
    state.layers = [{ type: "brush", imageData }];
    state.selectedLayerIndex = 0;
    render();
    renderLayersPanel();
    pushUndo();
}

// ---------------------------------------------------------------------------
// Undo / redo
// ---------------------------------------------------------------------------
export function deepCopyLayers(source) {
    return source.map(layer => {
        if (layer.type === "brush") {
            const id = layer.imageData;
            return { type: "brush", imageData: new ImageData(new Uint8ClampedArray(id.data), id.width, id.height) };
        }
        return JSON.parse(JSON.stringify(layer));
    });
}

function cloneImageCanvas() {
    const imgCanvas = document.createElement("canvas");
    imgCanvas.width = state.originalImage.width;
    imgCanvas.height = state.originalImage.height;
    imgCanvas.getContext("2d").drawImage(state.originalImage, 0, 0);
    return imgCanvas;
}

export function pushUndo() {
    state.undoStack.push({ layers: deepCopyLayers(state.layers), original: cloneImageCanvas() });
    if (state.undoStack.length > state.MAX_UNDO) { state.undoStack.shift(); }
    state.redoStack = [];
    updateHistoryButtons();
}

export function updateHistoryButtons() {
    dom.undoBtn.disabled = state.undoStack.length <= 1;
    dom.redoBtn.disabled = state.redoStack.length === 0;
}

export function restoreSnapshot(snap) {
    state.layers = deepCopyLayers(snap.layers);
    state.selectedLayerIndex = -1;

    const img = new Image();
    img.onload = () => {
        state.originalImage = img;
        canvas.width = img.width;
        canvas.height = img.height;

        state.activeBrushCanvas = document.createElement("canvas");
        state.activeBrushCanvas.width = img.width;
        state.activeBrushCanvas.height = img.height;
        state.activeBrushCtx = state.activeBrushCanvas.getContext("2d");

        render();
        renderLayersPanel();
        syncResizeInputs();
    };
    img.src = snap.original.toDataURL();
}

// ---------------------------------------------------------------------------
// Flood fill
// ---------------------------------------------------------------------------
export function floodFillAt(px, py) {
    const x = Math.floor(px);
    const y = Math.floor(py);
    const w = canvas.width;
    const h = canvas.height;
    if (x < 0 || x >= w || y < 0 || y >= h) { return; }

    const composite = buildCompositeCanvas();
    const source = composite.getContext("2d").getImageData(0, 0, w, h).data;

    const idx = (y * w + x) * 4;
    const startR = source[idx];
    const startG = source[idx + 1];
    const startB = source[idx + 2];
    const startA = source[idx + 3];

    const hex = dom.fillColor.value;
    const fillR = parseInt(hex.substr(1, 2), 16);
    const fillG = parseInt(hex.substr(3, 2), 16);
    const fillB = parseInt(hex.substr(5, 2), 16);

    if (startR === fillR && startG === fillG && startB === fillB && startA === 255) { return; }

    const tol = parseInt(dom.fillTolerance.value, 10);
    const outCanvas = document.createElement("canvas");
    outCanvas.width = w;
    outCanvas.height = h;
    const outCtx = outCanvas.getContext("2d");
    const out = outCtx.getImageData(0, 0, w, h);
    const outData = out.data;

    const visited = new Uint8Array(w * h);
    const stack = [x + y * w];
    visited[x + y * w] = 1;

    while (stack.length > 0) {
        const p = stack.pop();
        const cx = p % w;
        const cy = (p - cx) / w;
        const i = p * 4;
        const dr = source[i] - startR;
        const dg = source[i + 1] - startG;
        const db = source[i + 2] - startB;
        const da = source[i + 3] - startA;
        if (Math.sqrt(dr * dr + dg * dg + db * db + da * da) <= tol) {
            outData[i] = fillR;
            outData[i + 1] = fillG;
            outData[i + 2] = fillB;
            outData[i + 3] = 255;
            if (cx > 0 && !visited[p - 1]) { visited[p - 1] = 1; stack.push(p - 1); }
            if (cx < w - 1 && !visited[p + 1]) { visited[p + 1] = 1; stack.push(p + 1); }
            if (cy > 0 && !visited[p - w]) { visited[p - w] = 1; stack.push(p - w); }
            if (cy < h - 1 && !visited[p + w]) { visited[p + w] = 1; stack.push(p + w); }
        }
    }

    outCtx.putImageData(out, 0, 0);
    state.layers.push({ type: "brush", imageData: outCtx.getImageData(0, 0, w, h) });
    state.selectedLayerIndex = state.layers.length - 1;
    render();
    renderLayersPanel();
    pushUndo();
}

// ---------------------------------------------------------------------------
// Transparency fill
// ---------------------------------------------------------------------------
function computeEdgeStrengthMap(source, w, h) {
    const edgeMap = new Uint16Array(w * h);
    const lum = new Float32Array(w * h);

    for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
        lum[i] = source[p] * 0.299 + source[p + 1] * 0.587 + source[p + 2] * 0.114;
    }

    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            const gx = -lum[i - w - 1] + lum[i - w + 1] + -2 * lum[i - 1] + 2 * lum[i + 1] + -lum[i + w - 1] + lum[i + w + 1];
            const gy = -lum[i - w - 1] - 2 * lum[i - w] - lum[i - w + 1] + lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1];
            edgeMap[i] = Math.min(255, Math.sqrt(gx * gx + gy * gy));
        }
    }

    return edgeMap;
}

export function transparencyFillAt(px, py) {
    const x = Math.floor(px);
    const y = Math.floor(py);
    const w = canvas.width;
    const h = canvas.height;
    if (x < 0 || x >= w || y < 0 || y >= h) { return; }

    const composite = buildCompositeCanvas();
    const cctx = composite.getContext("2d");
    const source = cctx.getImageData(0, 0, w, h).data;

    const seed = (y * w + x) * 4;
    const startR = source[seed];
    const startG = source[seed + 1];
    const startB = source[seed + 2];
    const startA = source[seed + 3];
    if (startA === 0) { return; }

    const tol = parseInt(dom.transparencyTolerance.value, 10);
    const useEdgeDetect = dom.transparencyEdgeDetect.checked;
    const edgeThreshold = parseInt(dom.transparencyEdgeThreshold.value, 10);
    const edgeMap = useEdgeDetect ? computeEdgeStrengthMap(source, w, h) : null;

    const outCanvas = document.createElement("canvas");
    outCanvas.width = w;
    outCanvas.height = h;
    const outCtx = outCanvas.getContext("2d");
    outCtx.drawImage(composite, 0, 0);
    const out = outCtx.getImageData(0, 0, w, h);
    const outData = out.data;

    const visited = new Uint8Array(w * h);
    const stack = [x + y * w];
    visited[x + y * w] = 1;

    while (stack.length > 0) {
        const p = stack.pop();
        const cx = p % w;
        const cy = (p - cx) / w;
        const i = p * 4;

        if (useEdgeDetect && edgeMap[p] > edgeThreshold) { continue; }

        const dr = source[i] - startR;
        const dg = source[i + 1] - startG;
        const db = source[i + 2] - startB;
        const da = source[i + 3] - startA;
        if (Math.sqrt(dr * dr + dg * dg + db * db + da * da) <= tol) {
            outData[i + 3] = 0;
            if (cx > 0 && !visited[p - 1]) { visited[p - 1] = 1; stack.push(p - 1); }
            if (cx < w - 1 && !visited[p + 1]) { visited[p + 1] = 1; stack.push(p + 1); }
            if (cy > 0 && !visited[p - w]) { visited[p - w] = 1; stack.push(p - w); }
            if (cy < h - 1 && !visited[p + w]) { visited[p + w] = 1; stack.push(p + w); }
        }
    }

    outCtx.putImageData(out, 0, 0);
    replaceWithRasterCanvas(outCanvas);
}
