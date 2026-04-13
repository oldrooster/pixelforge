// Entry point. Wires all event listeners and runs startup initialisation.
// All logic lives in the imported modules.

import { state } from "./state.js";
import { canvas, dom } from "./dom.js";
import {
    setTool, updateToolSettingsForActiveTool, updateShapeFillVisibility,
    updateTransparencyMethodUI, updateInpaintMaskModeUI, toggleInpaintMaskMode,
    showTopNotice, dismissTopNotice, initToolPanels,
} from "./ui.js";
import {
    render, setZoom, applySelectionMove, applyCrop, applyResize, deleteSelection,
    getCanvasPos, normalizeRect, buildCompositeCanvas, flattenToBlob,
    clearCropState, clearSelectionState, updateCropLabel, updateSelectionLabel,
    createFloatingSelection, pointInRect,
    paintInpaintMaskDot, paintInpaintMaskStroke, clearInpaintMask,
    wandFloodSelect,
} from "./canvas.js";
import {
    renderLayersPanel, pushUndo, updateHistoryButtons, restoreSnapshot,
    hitTestLayers, createShapeLayer, drawLayer, floodFillAt, transparencyFillAt,
    flattenAllLayers,
} from "./layers.js";
import { loadImageFile, deleteActiveThumb } from "./thumbs.js";
import { runVertexGenerate, runVertexRefine, runVertexInpaint, runAiObjectRemoval, runAiUpscale, runAiDescribe, runAiBackgroundRemoval } from "./api.js";

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
initToolPanels();
updateToolSettingsForActiveTool();
updateShapeFillVisibility();
updateTransparencyMethodUI();
updateInpaintMaskModeUI();
showTopNotice("AI idle.", "success", 1500);

// ---------------------------------------------------------------------------
// Top notice close
// ---------------------------------------------------------------------------
dom.topNoticeClose.addEventListener("click", dismissTopNotice);

// ---------------------------------------------------------------------------
// Tool buttons
// ---------------------------------------------------------------------------
Object.keys(dom.toolButtons).forEach(name => {
    dom.toolButtons[name].addEventListener("click", () => setTool(name));
});

// ---------------------------------------------------------------------------
// Slider labels
// ---------------------------------------------------------------------------
dom.brushSize.addEventListener("input", () => { dom.brushSizeLabel.textContent = dom.brushSize.value; });
dom.fillTolerance.addEventListener("input", () => { dom.fillToleranceLabel.textContent = dom.fillTolerance.value; });
dom.transparencyTolerance.addEventListener("input", () => { dom.transparencyToleranceLabel.textContent = dom.transparencyTolerance.value; });
dom.transparencyEdgeThreshold.addEventListener("input", () => { dom.transparencyEdgeThresholdLabel.textContent = dom.transparencyEdgeThreshold.value; });
dom.fontSize.addEventListener("input", () => { dom.fontSizeLabel.textContent = dom.fontSize.value; });
dom.strokeSize.addEventListener("input", () => { dom.strokeSizeLabel.textContent = dom.strokeSize.value; });
dom.inpaintBrushSize.addEventListener("input", () => { dom.inpaintBrushSizeLabel.textContent = dom.inpaintBrushSize.value; });
dom.removeBrushSize.addEventListener("input", () => { dom.removeBrushSizeLabel.textContent = dom.removeBrushSize.value; });
dom.wandTolerance.addEventListener("input", () => { dom.wandToleranceLabel.textContent = dom.wandTolerance.value; });

// ---------------------------------------------------------------------------
// Shape / transparency / inpaint sub-controls
// ---------------------------------------------------------------------------
dom.shapeFillEnabled.addEventListener("change", updateShapeFillVisibility);
dom.shapeTypeRadios.forEach(r => r.addEventListener("change", updateShapeFillVisibility));
dom.transparencyMethodRadios.forEach(r => r.addEventListener("change", updateTransparencyMethodUI));
dom.inpaintMaskModeRadios.forEach(r => {
    r.addEventListener("change", () => { updateInpaintMaskModeUI(); render(); });
});
dom.inpaintClearMaskBtn.addEventListener("click", clearInpaintMask);
dom.removeClearMaskBtn.addEventListener("click", clearInpaintMask);

// ---------------------------------------------------------------------------
// Resize locked aspect ratio
// ---------------------------------------------------------------------------
dom.resizeWidth.addEventListener("input", () => {
    if (!dom.resizeLockAspect.checked || !state.resizeAspectRatio || !state.originalImage) { return; }
    const w = parseInt(dom.resizeWidth.value, 10);
    if (!w || w < 1) { return; }
    dom.resizeHeight.value = String(Math.max(1, Math.round(w / state.resizeAspectRatio)));
});

dom.resizeHeight.addEventListener("input", () => {
    if (!dom.resizeLockAspect.checked || !state.resizeAspectRatio || !state.originalImage) { return; }
    const h = parseInt(dom.resizeHeight.value, 10);
    if (!h || h < 1) { return; }
    dom.resizeWidth.value = String(Math.max(1, Math.round(h * state.resizeAspectRatio)));
});

dom.resizeApplyBtn.addEventListener("click", applyResize);

// ---------------------------------------------------------------------------
// Crop / selection buttons
// ---------------------------------------------------------------------------
dom.cropApplyBtn.addEventListener("click", applyCrop);
dom.cropCancelBtn.addEventListener("click", () => { clearCropState(); render(); });
dom.selectionApplyBtn.addEventListener("click", applySelectionMove);
dom.selectionCancelBtn.addEventListener("click", () => { clearSelectionState(); render(); });
dom.selectionDeleteBtn.addEventListener("click", deleteSelection);

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
dom.undoBtn.addEventListener("click", () => {
    if (state.undoStack.length <= 1) { return; }
    const current = state.undoStack.pop();
    state.redoStack.push(current);
    restoreSnapshot(state.undoStack[state.undoStack.length - 1]);
    updateHistoryButtons();
});

dom.redoBtn.addEventListener("click", () => {
    if (state.redoStack.length === 0) { return; }
    const next = state.redoStack.pop();
    state.undoStack.push(next);
    restoreSnapshot(next);
    updateHistoryButtons();
});

dom.flattenBtn.addEventListener("click", () => flattenAllLayers());

dom.clearBtn.addEventListener("click", () => {
    if (!state.originalImage) { return; }
    state.layers = [];
    state.selectedLayerIndex = -1;
    render();
    renderLayersPanel();
    pushUndo();
});

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------
dom.zoomInBtn.addEventListener("click", () => setZoom(state.zoomLevel * 1.25));
dom.zoomOutBtn.addEventListener("click", () => setZoom(state.zoomLevel / 1.25));
dom.zoom100Btn.addEventListener("click", () => setZoom(1.0));
dom.zoomFitBtn.addEventListener("click", () => setZoom("fit"));
dom.thumbDeleteBtn.addEventListener("click", deleteActiveThumb);

dom.canvasWrap.addEventListener("wheel", e => {
    if (!state.originalImage) { return; }
    e.preventDefault();
    setZoom(state.zoomLevel * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
}, { passive: false });

// ---------------------------------------------------------------------------
// AI buttons
// ---------------------------------------------------------------------------
dom.transparencyAiApplyBtn.addEventListener("click", () => runAiBackgroundRemoval());
dom.aiGeneratePanelBtn.addEventListener("click", () => runVertexGenerate());
dom.aiRefinePanelBtn.addEventListener("click", () => runVertexRefine());
dom.aiInpaintBtn.addEventListener("click", () => runVertexInpaint());

// Aspect ratio preset toggle (F10)
dom.aspectBtns.forEach(btn => {
    btn.addEventListener("click", () => {
        dom.aspectBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
    });
});
dom.aiRemoveBtn.addEventListener("click", () => runAiObjectRemoval());
dom.aiUpscaleBtn.addEventListener("click", () => runAiUpscale());
dom.aiDescribeRefineBtn.addEventListener("click", () => runAiDescribe(dom.aiRefinePromptPanel));
dom.aiDescribeGenerateBtn.addEventListener("click", () => runAiDescribe(dom.aiGeneratePromptPanel));

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------
dom.downloadBtn.addEventListener("click", async () => {
    if (!state.originalImage) { return; }
    const blob = await flattenToBlob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "pixelforge_markup.png";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
});

// ---------------------------------------------------------------------------
// File input / drag-drop / paste
// ---------------------------------------------------------------------------
dom.imageInput.addEventListener("change", () => {
    if (dom.imageInput.files && dom.imageInput.files[0]) {
        loadImageFile(dom.imageInput.files[0]);
    }
});

dom.emptyState.addEventListener("dragover", event => {
    event.preventDefault();
    dom.emptyState.classList.add("dragging");
});
dom.emptyState.addEventListener("dragleave", () => dom.emptyState.classList.remove("dragging"));
dom.emptyState.addEventListener("drop", event => {
    event.preventDefault();
    dom.emptyState.classList.remove("dragging");
    if (event.dataTransfer.files && event.dataTransfer.files[0]) {
        loadImageFile(event.dataTransfer.files[0]);
    }
});

document.addEventListener("paste", e => {
    const items = e.clipboardData?.items;
    if (!items) { return; }
    for (const item of items) {
        if (item.type.startsWith("image/")) {
            const blob = item.getAsFile();
            if (!blob) { continue; }
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                import("./canvas.js").then(({ activateCanvas }) => {
                    activateCanvas(img);
                    import("./thumbs.js").then(({ appendThumbSlot, updateThumbDeleteBtn: uTDB }) => {
                        const dataUrl = buildCompositeCanvas().toDataURL("image/png");
                        const idx = appendThumbSlot(dataUrl);
                        state.thumbSlots.forEach(s => s.el.classList.remove("selected"));
                        state.activeThumbIndex = idx;
                        state.thumbSlots[idx].el.classList.add("selected");
                        uTDB();
                    });
                });
            };
            img.src = url;
            e.preventDefault();
            break;
        }
    }
});

// ---------------------------------------------------------------------------
// Canvas mouse events
// ---------------------------------------------------------------------------
canvas.addEventListener("mousedown", event => {
    if (!state.originalImage) { return; }
    const pos = getCanvasPos(event);

    if (state.activeTool === "crop") {
        state.dragStart = { x: pos.x, y: pos.y };
        state.lastMousePos = pos;
        state.cropRect = null;
        updateCropLabel(null);
        render();
        return;
    }

    if (state.activeTool === "select" || (state.activeTool === "inpaint" && dom.inpaintMaskModeRadios.find(r => r.checked)?.value === "selection")) {
        if (state.floatingSelection && pointInRect(pos.x, pos.y, state.floatingSelection)) {
            state.isMovingSelection = true;
            state.selectionDragOffset = { x: pos.x - state.floatingSelection.x, y: pos.y - state.floatingSelection.y };
            return;
        }
        state.dragStart = { x: pos.x, y: pos.y };
        state.lastMousePos = pos;
        state.selectionRect = null;
        state.floatingSelection = null;
        state.selectionBackground = null;
        updateSelectionLabel(null);
        render();
        return;
    }

    if (state.activeTool === "inpaint" && dom.inpaintMaskModeRadios.find(r => r.checked)?.value === "brush") {
        state.isPaintingInpaintMask = true;
        state.inpaintMaskLastX = pos.x;
        state.inpaintMaskLastY = pos.y;
        paintInpaintMaskDot(pos.x, pos.y);
        render();
        return;
    }

    if (state.activeTool === "remove") {
        state.isPaintingInpaintMask = true;
        state.inpaintMaskLastX = pos.x;
        state.inpaintMaskLastY = pos.y;
        paintInpaintMaskDot(pos.x, pos.y, parseInt(dom.removeBrushSize.value, 10));
        render();
        return;
    }

    if (state.activeTool === "picker") {
        const px = Math.round(pos.x);
        const py = Math.round(pos.y);
        if (px >= 0 && px < canvas.width && py >= 0 && py < canvas.height) {
            const pixel = canvas.getContext("2d").getImageData(px, py, 1, 1).data;
            const hex = "#" + ((1 << 24) | (pixel[0] << 16) | (pixel[1] << 8) | pixel[2]).toString(16).slice(1);
            dom.brushColor.value = hex;
            dom.fillColor.value = hex;
            dom.textColor.value = hex;
            dom.shapeColor.value = hex;
            dom.pickerColorPreview.value = hex;
        }
        setTool(state.previousTool);
        return;
    }

    if (state.activeTool === "wand") {
        const tol = parseInt(dom.wandTolerance.value, 10);
        wandFloodSelect(pos.x, pos.y, tol);
        return;
    }

    if (state.activeTool === "fill") { floodFillAt(pos.x, pos.y); return; }

    if (state.activeTool === "transparency" && dom.transparencyMethodRadios.find(r => r.checked)?.value === "region") {
        transparencyFillAt(pos.x, pos.y);
        return;
    }

    if (state.activeTool === "text") {
        const hit = hitTestLayers(pos.x, pos.y);
        if (hit >= 0 && state.layers[hit].type === "text") {
            state.selectedLayerIndex = hit;
            state.isDragging = true;
            state.dragOffset = { x: pos.x - state.layers[hit].x, y: pos.y - state.layers[hit].y };
            render();
            renderLayersPanel();
            return;
        }
        const text = window.prompt("Enter text");
        if (!text || !text.trim()) { return; }
        state.layers.push({
            type: "text",
            text: text.trim(),
            x: pos.x, y: pos.y,
            fontFamily: dom.fontFamily.value,
            fontSize: parseInt(dom.fontSize.value, 10),
            color: dom.textColor.value,
        });
        state.selectedLayerIndex = state.layers.length - 1;
        render();
        renderLayersPanel();
        pushUndo();
        return;
    }

    if (state.activeTool === "brush") {
        state.isDrawing = true;
        state.brushPoints = [{ x: pos.x, y: pos.y }];
        state.activeBrushCtx.clearRect(0, 0, state.activeBrushCanvas.width, state.activeBrushCanvas.height);
        // Paint a dot at the starting point
        state.activeBrushCtx.beginPath();
        state.activeBrushCtx.arc(pos.x, pos.y, parseInt(dom.brushSize.value, 10) / 2, 0, Math.PI * 2);
        state.activeBrushCtx.fillStyle = dom.brushColor.value;
        state.activeBrushCtx.fill();
        render();
        return;
    }

    const hitLayer = hitTestLayers(pos.x, pos.y);
    if (hitLayer >= 0) {
        state.selectedLayerIndex = hitLayer;
        state.isDragging = true;
        const layer = state.layers[hitLayer];
        if (layer.type === "rect") {
            state.dragOffset = { x: pos.x - layer.x, y: pos.y - layer.y };
        } else if (layer.type === "ellipse") {
            state.dragOffset = { x: pos.x - layer.cx, y: pos.y - layer.cy };
        } else {
            state.dragOffset = { x: pos.x - layer.x1, y: pos.y - layer.y1 };
        }
        render();
        renderLayersPanel();
        return;
    }

    state.dragStart = { x: pos.x, y: pos.y };
    state.selectedLayerIndex = -1;
    render();
    renderLayersPanel();
});

canvas.addEventListener("mousemove", event => {
    if (!state.originalImage) { return; }
    const pos = getCanvasPos(event);
    state.lastMousePos = pos;

    if (state.activeTool === "crop" && state.dragStart) {
        state.cropRect = normalizeRect(state.dragStart.x, state.dragStart.y, pos.x, pos.y);
        updateCropLabel(state.cropRect);
        render();
        return;
    }

    const selectionMaskMode = dom.inpaintMaskModeRadios.find(r => r.checked)?.value ?? "selection";
    if (state.activeTool === "select" || (state.activeTool === "inpaint" && selectionMaskMode === "selection")) {
        if (state.isMovingSelection && state.floatingSelection) {
            state.floatingSelection.x = pos.x - state.selectionDragOffset.x;
            state.floatingSelection.y = pos.y - state.selectionDragOffset.y;
            state.selectionRect = { x: state.floatingSelection.x, y: state.floatingSelection.y, w: state.floatingSelection.w, h: state.floatingSelection.h };
            updateSelectionLabel(state.selectionRect);
            render();
            return;
        }
        if (state.dragStart) {
            state.selectionRect = normalizeRect(state.dragStart.x, state.dragStart.y, pos.x, pos.y);
            updateSelectionLabel(state.selectionRect);
            render();
            return;
        }
    }

    if (state.activeTool === "inpaint" && selectionMaskMode === "brush" && state.isPaintingInpaintMask) {
        paintInpaintMaskStroke(state.inpaintMaskLastX, state.inpaintMaskLastY, pos.x, pos.y);
        state.inpaintMaskLastX = pos.x;
        state.inpaintMaskLastY = pos.y;
        render();
        return;
    }

    if (state.activeTool === "remove" && state.isPaintingInpaintMask) {
        paintInpaintMaskStroke(state.inpaintMaskLastX, state.inpaintMaskLastY, pos.x, pos.y, parseInt(dom.removeBrushSize.value, 10));
        state.inpaintMaskLastX = pos.x;
        state.inpaintMaskLastY = pos.y;
        render();
        return;
    }

    if (state.activeTool === "brush" && state.isDrawing) {
        state.brushPoints.push({ x: pos.x, y: pos.y });
        const pts = state.brushPoints;
        const bctx = state.activeBrushCtx;
        bctx.strokeStyle = dom.brushColor.value;
        bctx.lineWidth = parseInt(dom.brushSize.value, 10);
        bctx.lineCap = "round";
        bctx.lineJoin = "round";
        if (pts.length >= 3) {
            // Smooth quadratic bezier through midpoints (F5)
            const p0 = pts[pts.length - 3];
            const p1 = pts[pts.length - 2];
            const p2 = pts[pts.length - 1];
            const mid1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
            const mid2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
            bctx.beginPath();
            bctx.moveTo(mid1.x, mid1.y);
            bctx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
            bctx.stroke();
        } else {
            const p0 = pts[pts.length - 2];
            bctx.beginPath();
            bctx.moveTo(p0.x, p0.y);
            bctx.lineTo(pos.x, pos.y);
            bctx.stroke();
        }
        render();
        return;
    }

    if (state.isDragging && state.selectedLayerIndex >= 0) {
        const layer = state.layers[state.selectedLayerIndex];
        if (layer.type === "text") {
            layer.x = pos.x - state.dragOffset.x;
            layer.y = pos.y - state.dragOffset.y;
        } else if (layer.type === "rect") {
            layer.x = pos.x - state.dragOffset.x;
            layer.y = pos.y - state.dragOffset.y;
        } else if (layer.type === "ellipse") {
            layer.cx = pos.x - state.dragOffset.x;
            layer.cy = pos.y - state.dragOffset.y;
        } else if (layer.type === "line" || layer.type === "arrow") {
            const dx = (pos.x - state.dragOffset.x) - layer.x1;
            const dy = (pos.y - state.dragOffset.y) - layer.y1;
            layer.x1 += dx; layer.y1 += dy;
            layer.x2 += dx; layer.y2 += dy;
            state.dragOffset = { x: pos.x - layer.x1, y: pos.y - layer.y1 };
        }
        render();
        return;
    }

    if (state.dragStart && state.activeTool === "shapes") {
        render();
        const preview = createShapeLayer(state.dragStart.x, state.dragStart.y, pos.x, pos.y);
        if (preview) { drawLayer(canvas.getContext("2d"), preview); }
    }
});

window.addEventListener("mouseup", () => {
    if (!state.originalImage) { return; }

    if (state.activeTool === "crop" && state.dragStart && state.lastMousePos) {
        state.cropRect = normalizeRect(state.dragStart.x, state.dragStart.y, state.lastMousePos.x, state.lastMousePos.y);
        state.dragStart = null;
        updateCropLabel(state.cropRect);
        render();
        return;
    }

    const selectionMaskMode = dom.inpaintMaskModeRadios.find(r => r.checked)?.value ?? "selection";
    if (state.activeTool === "select" || (state.activeTool === "inpaint" && selectionMaskMode === "selection")) {
        if (state.isMovingSelection) { state.isMovingSelection = false; return; }
        if (state.dragStart && state.lastMousePos) {
            state.selectionRect = normalizeRect(state.dragStart.x, state.dragStart.y, state.lastMousePos.x, state.lastMousePos.y);
            if (state.selectionRect.w > 3 && state.selectionRect.h > 3) {
                createFloatingSelection(state.selectionRect);
            }
            state.dragStart = null;
            render();
            return;
        }
        state.dragStart = null;
        return;
    }

    if ((state.activeTool === "inpaint" && selectionMaskMode === "brush" && state.isPaintingInpaintMask) ||
        (state.activeTool === "remove" && state.isPaintingInpaintMask)) {
        state.isPaintingInpaintMask = false;
        render();
        return;
    }

    if (state.isDrawing && state.activeTool === "brush") {
        state.isDrawing = false;
        state.layers.push({
            type: "brush",
            imageData: state.activeBrushCtx.getImageData(0, 0, state.activeBrushCanvas.width, state.activeBrushCanvas.height),
        });
        state.selectedLayerIndex = state.layers.length - 1;
        state.activeBrushCtx.clearRect(0, 0, state.activeBrushCanvas.width, state.activeBrushCanvas.height);
        render();
        renderLayersPanel();
        pushUndo();
    }

    if (state.isDragging) { state.isDragging = false; pushUndo(); }

    if (state.activeTool === "shapes" && state.dragStart && state.lastMousePos) {
        const dx = Math.abs(state.lastMousePos.x - state.dragStart.x);
        const dy = Math.abs(state.lastMousePos.y - state.dragStart.y);
        if (dx > 3 || dy > 3) {
            const layer = createShapeLayer(state.dragStart.x, state.dragStart.y, state.lastMousePos.x, state.lastMousePos.y);
            if (layer) {
                state.layers.push(layer);
                state.selectedLayerIndex = state.layers.length - 1;
                render();
                renderLayersPanel();
                pushUndo();
            }
        }
        state.dragStart = null;
    }
});

// ---------------------------------------------------------------------------
// Text double-click edit (F7)
// ---------------------------------------------------------------------------
canvas.addEventListener("dblclick", event => {
    if (!state.originalImage || state.activeTool !== "text") { return; }
    const pos = getCanvasPos(event);
    const hit = hitTestLayers(pos.x, pos.y);
    if (hit < 0 || state.layers[hit].type !== "text") { return; }
    const layer = state.layers[hit];
    const newText = window.prompt("Edit text", layer.text);
    if (newText === null) { return; }
    if (!newText.trim()) {
        state.layers.splice(hit, 1);
        state.selectedLayerIndex = -1;
    } else {
        layer.text = newText.trim();
        state.selectedLayerIndex = hit;
    }
    render();
    renderLayersPanel();
    pushUndo();
});

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------
document.addEventListener("keydown", event => {
    const tag = event.target?.tagName ?? "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || event.target?.isContentEditable) { return; }

    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
        event.preventDefault(); dom.undoBtn.click(); return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault(); dom.redoBtn.click(); return;
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "z") {
        event.preventDefault(); dom.redoBtn.click(); return;
    }
    if (event.ctrlKey || event.metaKey) { return; }

    const key = event.key.toLowerCase();
    const simpleTools = { b: "brush", t: "text", v: "select", c: "crop", f: "fill", p: "picker", s: "resize", x: "transparency", i: "inpaint" };
    if (simpleTools[key]) { setTool(simpleTools[key]); event.preventDefault(); return; }

    const shapeKeys = { l: "line", a: "arrow", r: "rect", e: "ellipse" };
    if (shapeKeys[key]) {
        setTool("shapes");
        dom.shapeTypeRadios.forEach(radio => { radio.checked = radio.value === shapeKeys[key]; });
        import("./ui.js").then(({ updateShapeFillVisibility: uSFV }) => uSFV());
        event.preventDefault();
        return;
    }

    if (key === "m") {
        if (state.activeTool !== "inpaint") { setTool("inpaint"); }
        toggleInpaintMaskMode();
        event.preventDefault();
        return;
    }

    if (!state.originalImage) { return; }

    if (event.key === "Enter") {
        if (state.activeTool === "crop" && state.cropRect) { applyCrop(); event.preventDefault(); return; }
        if (state.activeTool === "select" && state.floatingSelection) { applySelectionMove(); event.preventDefault(); return; }
    }

    if (event.key === "Escape") {
        if (state.activeTool === "crop" && state.cropRect) { clearCropState(); render(); event.preventDefault(); return; }
        if (state.activeTool === "select" && (state.selectionRect || state.floatingSelection)) { clearSelectionState(); render(); event.preventDefault(); return; }
    }

    if (event.key !== "Delete" && event.key !== "Backspace") { return; }
    if (state.selectedLayerIndex < 0) { return; }
    event.preventDefault();
    state.layers.splice(state.selectedLayerIndex, 1);
    state.selectedLayerIndex = -1;
    render();
    renderLayersPanel();
    pushUndo();
});
