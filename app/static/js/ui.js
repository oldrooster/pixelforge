// UI helpers: tool switching, panel visibility, notices, status indicators.
// Imports from canvas.js create a circular dependency (canvas→ui, ui→canvas)
// which ES modules handle correctly via live bindings.

import { state } from "./state.js";
import { canvas, dom } from "./dom.js";
import { render, clearCropState, clearSelectionState } from "./canvas.js";

// ---------------------------------------------------------------------------
// Tool configuration table (replaces the if-else chain — Phase 1, item 1.6)
// ---------------------------------------------------------------------------
const TOOL_CONFIG = {
    brush:        { panel: dom.brushSettings,        title: "Brush controls",          desc: "Draw freehand strokes on a new layer.",                                                       cursor: "crosshair" },
    fill:         { panel: dom.fillSettings,         title: "Fill controls",           desc: "Fill contiguous pixels by color tolerance.",                                                  cursor: "crosshair" },
    text:         { panel: dom.textSettings,         title: "Text controls",           desc: "Click anywhere on the image to place text.",                                                  cursor: "text"      },
    shapes:       { panel: dom.shapeSettings,        title: "Shape controls",          desc: "Pick a shape type and drag on canvas to draw.",                                               cursor: "crosshair" },
    picker:       { panel: dom.pickerSettings,       title: "Picker controls",         desc: "Sample a color and return to your previous tool.",                                            cursor: "crosshair" },
    crop:         { panel: dom.cropSettings,         title: "Crop controls",           desc: "Drag to define a crop area, then apply crop.",                                                cursor: "crosshair" },
    select:       { panel: dom.selectSettings,       title: "Select controls",         desc: "Select an area and drag it to move.",                                                         cursor: "crosshair" },
    resize:       { panel: dom.resizeSettings,       title: "Resize controls",         desc: "Set target width and height, then apply resize.",                                             cursor: "crosshair" },
    wand:         { panel: dom.wandSettings,          title: "Magic Wand controls",     desc: "Click a colour region to auto-select it as a selection mask for Inpaint or Remove.",       cursor: "crosshair" },
    transparency: { panel: dom.transparencySettings, title: "Transparency controls",   desc: "Use region fill or AI removal to make backgrounds transparent.",                             cursor: "crosshair" },
    inpaint:      { panel: dom.inpaintSettings,      title: "Inpaint controls",        desc: "Use selection mask or brush mask, then inpaint via Vertex AI.",                             cursor: "crosshair" },
    remove:       { panel: dom.removeSettings,       title: "Remove Object controls",  desc: "Paint over an object and AI will erase it and fill the background.",                        cursor: "crosshair" },
    generate:     { panel: dom.generateSettings,     title: "AI Generate controls",    desc: "Generate images from a prompt. Click a thumbnail to use it.",                               cursor: "default"   },
    refine:       { panel: dom.refineSettings,       title: "Image to Image controls", desc: "Generate new images using the current image as a reference. Click a thumbnail to use it.", cursor: "default"   },
};

// ---------------------------------------------------------------------------
// Panel visibility
// ---------------------------------------------------------------------------
function animatePanelEntry(panel) {
    panel.classList.remove("panel-enter");
    void panel.offsetWidth; // force reflow
    panel.classList.add("panel-enter");
}

export function setPanelVisible(panel, shouldShow) {
    const isVisible = !panel.hidden;
    if (shouldShow) {
        panel.hidden = false;
        if (!isVisible) { animatePanelEntry(panel); }
        return;
    }
    panel.hidden = true;
    panel.classList.remove("panel-enter");
}

function animateContextRefresh() {
    const header = dom.toolContextTitle.parentElement;
    if (!header) { return; }
    header.classList.remove("context-refresh");
    void header.offsetWidth;
    header.classList.add("context-refresh");
}

// Call once at startup to stamp all panels with the animation class.
export function initToolPanels() {
    Object.values(TOOL_CONFIG).forEach(config => config.panel.classList.add("tool-panel"));
}

export function updateToolSettingsForActiveTool() {
    Object.values(TOOL_CONFIG).forEach(config => setPanelVisible(config.panel, false));

    const config = TOOL_CONFIG[state.activeTool];
    if (config) {
        setPanelVisible(config.panel, true);
        dom.toolContextTitle.textContent = config.title;
        dom.toolContextDescription.textContent = config.desc;
        canvas.style.cursor = config.cursor;
    }

    if (state.activeTool === "shapes") {
        updateShapeFillVisibility();
    }

    animateContextRefresh();
}

// ---------------------------------------------------------------------------
// Tool switching
// ---------------------------------------------------------------------------
export function setTool(tool) {
    if (!dom.toolButtons[tool]) { return; }

    if (state.activeTool === "crop" && tool !== "crop") { clearCropState(); }
    if (state.activeTool === "select" && tool !== "select") { clearSelectionState(); }

    if (tool !== "picker") { state.previousTool = tool; }

    state.activeTool = tool;
    Object.keys(dom.toolButtons).forEach(key => {
        dom.toolButtons[key].classList.toggle("active", key === tool);
    });
    updateToolSettingsForActiveTool();
}

// ---------------------------------------------------------------------------
// Shape sub-controls
// ---------------------------------------------------------------------------
export function updateShapeFillVisibility() {
    const shapeType = getSelectedShapeType();
    const supportsShapeFill = shapeType === "rect" || shapeType === "ellipse";
    dom.shapeFillToggleWrap.hidden = !supportsShapeFill;
    if (!supportsShapeFill) { dom.shapeFillEnabled.checked = false; }
    dom.shapeColorLabel.textContent = (shapeType === "line" || shapeType === "arrow") ? "Line color" : "Stroke color";
    dom.shapeFillColor.hidden = !dom.shapeFillEnabled.checked || !supportsShapeFill;
}

export function getSelectedShapeType() {
    const checked = dom.shapeTypeRadios.find(r => r.checked);
    return checked ? checked.value : "line";
}

// ---------------------------------------------------------------------------
// Transparency sub-controls
// ---------------------------------------------------------------------------
export function updateTransparencyMethodUI() {
    const isRegion = getTransparencyMethod() === "region";
    dom.transparencyRegionControls.hidden = !isRegion;
    dom.transparencyAiControls.hidden = isRegion;
}

export function getTransparencyMethod() {
    const checked = dom.transparencyMethodRadios.find(r => r.checked);
    return checked ? checked.value : "region";
}

// ---------------------------------------------------------------------------
// Inpaint mask mode
// ---------------------------------------------------------------------------
export function getInpaintMaskMode() {
    const checked = dom.inpaintMaskModeRadios.find(r => r.checked);
    return checked ? checked.value : "selection";
}

export function updateInpaintMaskModeUI() {
    const mode = getInpaintMaskMode();
    dom.inpaintSelectionControls.hidden = mode !== "selection";
    dom.inpaintBrushControls.hidden = mode !== "brush";
}

export function toggleInpaintMaskMode() {
    const nextMode = getInpaintMaskMode() === "selection" ? "brush" : "selection";
    dom.inpaintMaskModeRadios.forEach(radio => { radio.checked = radio.value === nextMode; });
    updateInpaintMaskModeUI();
    render();
}

// ---------------------------------------------------------------------------
// Status displays
// ---------------------------------------------------------------------------
let topNoticeTimer = null;

export function showTopNotice(message, noticeState, autoHideMs) {
    dom.topNotice.hidden = false;
    dom.topNoticeText.textContent = message;
    dom.topNotice.classList.remove("running", "success", "error");
    if (noticeState) { dom.topNotice.classList.add(noticeState); }
    if (topNoticeTimer) { window.clearTimeout(topNoticeTimer); }
    if (autoHideMs && autoHideMs > 0) {
        topNoticeTimer = window.setTimeout(() => { dom.topNotice.hidden = true; }, autoHideMs);
    }
}

export function dismissTopNotice() {
    if (topNoticeTimer) { window.clearTimeout(topNoticeTimer); }
    dom.topNotice.hidden = true;
}

export function setAiStatus(message, statusState) {
    dom.transparencyAiStatus.textContent = message;
    dom.transparencyAiStatus.classList.remove("running", "success", "error");
    if (statusState) { dom.transparencyAiStatus.classList.add(statusState); }
}

export function setAiButtonBusy(isBusy) {
    state.isAiRemovalRunning = isBusy;
    dom.transparencyAiApplyBtn.disabled = isBusy;
    dom.transparencyAiApplyBtn.textContent = isBusy ? "Working..." : "Run AI background removal";
}

export function setVertexButtonsBusy(isBusy) {
    state.isVertexOpRunning = isBusy;
    dom.aiGeneratePanelBtn.disabled = isBusy;
    dom.aiRefinePanelBtn.disabled = isBusy;
    dom.aiInpaintBtn.disabled = isBusy;
    dom.aiRemoveBtn.disabled = isBusy;
    dom.aiUpscaleBtn.disabled = isBusy;
    dom.aiGeneratePanelBtn.textContent = isBusy ? "Generating..." : "Generate Images";
    dom.aiRefinePanelBtn.textContent = isBusy ? "Generating..." : "Generate from Reference";
    dom.aiInpaintBtn.textContent = isBusy ? "Inpainting..." : "AI Inpaint";
    dom.aiRemoveBtn.textContent = isBusy ? "Removing..." : "Remove Object";
    dom.aiUpscaleBtn.textContent = isBusy ? "Upscaling..." : "AI Upscale Current Image";
}
