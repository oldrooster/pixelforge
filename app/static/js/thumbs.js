// Thumbnail slot management, image loading, and per-slot state persistence.

import { state } from "./state.js";
import { dom } from "./dom.js";
import { activateCanvas, buildCompositeCanvas, setZoom, syncResizeInputs, clearCropState, clearSelectionState } from "./canvas.js";
import { renderLayersPanel, updateHistoryButtons } from "./layers.js";

// ---------------------------------------------------------------------------
// Thumbnail strip
// ---------------------------------------------------------------------------
export function appendThumbSlot(dataUrl) {
    const slot = { el: null, dataUrl, savedState: null };
    const thumbImg = document.createElement("img");
    thumbImg.src = dataUrl;
    thumbImg.title = "Click to use this image";
    slot.el = thumbImg;
    dom.generateThumbs.appendChild(thumbImg);
    state.thumbSlots.push(slot);
    thumbImg.addEventListener("click", () => {
        const idx = state.thumbSlots.indexOf(slot);
        if (idx >= 0) { selectThumbSlot(idx); }
    });
    dom.generateThumbs.hidden = false;
    return state.thumbSlots.length - 1;
}

export function updateThumbDeleteBtn() {
    dom.thumbDeleteBtn.hidden = state.thumbSlots.length === 0;
}

export function deleteActiveThumb() {
    if (state.activeThumbIndex < 0 || state.thumbSlots.length === 0) { return; }
    if (!window.confirm("Delete this thumbnail?")) { return; }
    const slot = state.thumbSlots[state.activeThumbIndex];
    dom.generateThumbs.removeChild(slot.el);
    state.thumbSlots.splice(state.activeThumbIndex, 1);
    if (state.thumbSlots.length === 0) {
        dom.generateThumbs.hidden = true;
        state.activeThumbIndex = -1;
        updateThumbDeleteBtn();
        return;
    }
    const newIndex = Math.min(state.activeThumbIndex, state.thumbSlots.length - 1);
    state.activeThumbIndex = -1;
    selectThumbSlot(newIndex);
    updateThumbDeleteBtn();
}

export function clearGenerateThumbs() {
    dom.generateThumbs.hidden = true;
    dom.generateThumbs.innerHTML = "";
    state.thumbSlots = [];
    state.activeThumbIndex = -1;
    updateThumbDeleteBtn();
}

// ---------------------------------------------------------------------------
// Per-slot state persistence
// ---------------------------------------------------------------------------
export function saveCurrentThumbState() {
    if (state.activeThumbIndex < 0 || state.activeThumbIndex >= state.thumbSlots.length || !state.originalImage) { return; }
    const slot = state.thumbSlots[state.activeThumbIndex];
    // Store by reference — safe because switching replaces the current vars with new ones.
    slot.savedState = {
        originalImage: state.originalImage,
        layers: state.layers,
        selectedLayerIndex: state.selectedLayerIndex,
        undoStack: state.undoStack,
        redoStack: state.redoStack,
    };
    slot.el.src = buildCompositeCanvas().toDataURL("image/png");
}

function restoreThumbState(savedState) {
    state.originalImage = savedState.originalImage;
    state.layers = savedState.layers;
    state.selectedLayerIndex = savedState.selectedLayerIndex;
    state.undoStack = savedState.undoStack;
    state.redoStack = savedState.redoStack;

    const cnv = document.getElementById("markup-canvas");
    cnv.width = state.originalImage.width;
    cnv.height = state.originalImage.height;

    state.activeBrushCanvas = document.createElement("canvas");
    state.activeBrushCanvas.width = state.originalImage.width;
    state.activeBrushCanvas.height = state.originalImage.height;
    state.activeBrushCtx = state.activeBrushCanvas.getContext("2d");

    state.inpaintMaskCanvas = document.createElement("canvas");
    state.inpaintMaskCanvas.width = state.originalImage.width;
    state.inpaintMaskCanvas.height = state.originalImage.height;
    state.inpaintMaskCtx = state.inpaintMaskCanvas.getContext("2d");
    state.inpaintMaskHasPaint = false;

    clearCropState();
    clearSelectionState();

    // Lazy-import render to avoid the circular chain at module init time
    import("./canvas.js").then(({ render }) => {
        render();
        renderLayersPanel();
        updateHistoryButtons();
        syncResizeInputs();
        setZoom("fit");
    });
}

export function selectThumbSlot(index) {
    if (index === state.activeThumbIndex) { return; }
    saveCurrentThumbState();
    state.activeThumbIndex = index;
    const slot = state.thumbSlots[index];

    if (slot.savedState) {
        restoreThumbState(slot.savedState);
        dom.generateThumbs.hidden = false;
        state.thumbSlots.forEach(s => s.el.classList.remove("selected"));
        slot.el.classList.add("selected");
    } else {
        const img = new Image();
        img.onload = () => {
            activateCanvas(img);
            dom.generateThumbs.hidden = false;
            state.thumbSlots.forEach(s => s.el.classList.remove("selected"));
            slot.el.classList.add("selected");
        };
        img.src = slot.dataUrl;
    }
}

// ---------------------------------------------------------------------------
// Image loading
// ---------------------------------------------------------------------------
export function loadBase64AsImage(b64) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Could not decode generated image."));
        img.src = "data:image/png;base64," + b64;
    });
}

export function loadImageFile(file) {
    if (!file || !file.type.startsWith("image/")) { return; }
    const reader = new FileReader();
    reader.onload = e => {
        const img = new Image();
        img.onload = () => {
            const dataUrl = e.target.result;
            activateCanvas(img);
            const idx = appendThumbSlot(dataUrl);
            state.activeThumbIndex = idx;
            state.thumbSlots[idx].el.classList.add("selected");
            updateThumbDeleteBtn();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

export function applyBlobAsCanvas(blob) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            activateCanvas(img);
            if (state.activeThumbIndex >= 0 && state.activeThumbIndex < state.thumbSlots.length) {
                state.thumbSlots[state.activeThumbIndex].savedState = null;
            }
            resolve();
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Could not decode returned AI image."));
        };
        img.src = url;
    });
}
