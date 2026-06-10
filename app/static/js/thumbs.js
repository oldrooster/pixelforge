// Thumbnail slot management, image loading, and per-slot state persistence.

import { state } from "./state.js";
import { dom } from "./dom.js";
import { activateCanvas, buildCompositeCanvas, setZoom, syncResizeInputs, clearCropState, clearSelectionState } from "./canvas.js";
import { renderLayersPanel, updateHistoryButtons } from "./layers.js";

// ---------------------------------------------------------------------------
// Thumbnail strip
// ---------------------------------------------------------------------------
export function appendThumbSlot(dataUrl) {
    const slot = { el: null, dataUrl, savedState: null, isVideo: false };
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

export function appendVideoThumbSlot(videoDataUrl, onDownload) {
    const slot = { el: null, dataUrl: null, videoDataUrl, onDownload, savedState: null, isVideo: true };

    const wrapper = document.createElement("div");
    wrapper.className = "video-thumb-wrapper";

    const thumbImg = document.createElement("img");
    thumbImg.title = "Click to view this video";
    wrapper.appendChild(thumbImg);

    const badge = document.createElement("span");
    badge.className = "video-thumb-badge";
    badge.textContent = "▶";
    wrapper.appendChild(badge);

    slot.el = wrapper;

    // Capture first frame for the thumbnail image
    const vid = document.createElement("video");
    vid.preload = "metadata";
    vid.muted = true;
    vid.playsInline = true;
    vid.src = videoDataUrl;
    const captureFrame = () => {
        const c = document.createElement("canvas");
        c.width = vid.videoWidth || 160;
        c.height = vid.videoHeight || 90;
        c.getContext("2d").drawImage(vid, 0, 0);
        const frameUrl = c.toDataURL("image/jpeg", 0.8);
        thumbImg.src = frameUrl;
        slot.dataUrl = frameUrl;
    };
    vid.addEventListener("seeked", captureFrame, { once: true });
    vid.addEventListener("loadedmetadata", () => { vid.currentTime = 0.1; }, { once: true });
    vid.load();

    dom.generateThumbs.appendChild(wrapper);
    state.thumbSlots.push(slot);
    wrapper.addEventListener("click", () => {
        const idx = state.thumbSlots.indexOf(slot);
        if (idx >= 0) { selectThumbSlot(idx); }
    });
    dom.generateThumbs.hidden = false;
    updateThumbDeleteBtn();
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
        dom.videoResult.hidden = true;
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
    if (slot.isVideo) { return; }
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

    dom.emptyState.hidden = true;
    dom.canvasWrap.hidden = false;
    dom.zoomControls.hidden = false;

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

    dom.generateThumbs.hidden = false;
    state.thumbSlots.forEach(s => s.el.classList.remove("selected"));
    slot.el.classList.add("selected");

    if (slot.isVideo) {
        dom.canvasWrap.hidden = true;
        dom.zoomControls.hidden = true;
        dom.videoResult.hidden = false;
        dom.videoResultPlayer.src = slot.videoDataUrl;
        dom.videoResultPlayer.load();
        if (slot.onDownload) {
            dom.videoDownloadBtn.onclick = slot.onDownload;
        }
        return;
    }

    dom.videoResult.hidden = true;

    if (slot.savedState) {
        restoreThumbState(slot.savedState);
    } else {
        const img = new Image();
        img.onload = () => { activateCanvas(img); };
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
