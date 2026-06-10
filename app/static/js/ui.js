// UI helpers: tool switching, panel visibility, notices, status indicators.
// Imports from canvas.js create a circular dependency (canvas→ui, ui→canvas)
// which ES modules handle correctly via live bindings.

import { state } from "./state.js";
import { canvas, dom } from "./dom.js";
import { render, clearCropState, clearSelectionState } from "./canvas.js";

// ---------------------------------------------------------------------------
// Tool configuration table
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
    video:        { panel: dom.videoSettings,        title: "Video Generation",        desc: "Generate a video from the current image using Veo.",                                         cursor: "default"   },
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
// Busy state helpers
// ---------------------------------------------------------------------------
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
    dom.aiGeneratePanelBtn.textContent = isBusy ? "Generating..." : "Generate Images";
    dom.aiRefinePanelBtn.textContent = isBusy ? "Generating..." : "Generate from Reference";
    dom.aiInpaintBtn.textContent = isBusy ? "Inpainting..." : "AI Inpaint";
    dom.aiRemoveBtn.textContent = isBusy ? "Removing..." : "Remove Object";
}

export function setVideoButtonBusy(isBusy) {
    state.isVideoRunning = isBusy;
    dom.aiVideoBtn.disabled = isBusy;
    dom.aiVideoBtn.textContent = isBusy ? "Generating..." : "Generate Video";
}

// ---------------------------------------------------------------------------
// Notification bell system
// ---------------------------------------------------------------------------
function _relativeTime(date) {
    const secs = Math.floor((Date.now() - date.getTime()) / 1000);
    if (secs < 5) { return "just now"; }
    if (secs < 60) { return `${secs}s ago`; }
    if (secs < 3600) { return `${Math.floor(secs / 60)}m ago`; }
    return `${Math.floor(secs / 3600)}h ago`;
}

function _renderNotifPanel() {
    dom.notifList.innerHTML = "";

    if (state.notifications.length === 0) {
        const empty = document.createElement("div");
        empty.className = "notif-empty";
        empty.textContent = "No notifications";
        dom.notifList.appendChild(empty);
    } else {
        [...state.notifications].reverse().forEach(n => {
            const item = document.createElement("div");
            item.className = `notif-item ${n.type || ""}`;

            const dot = document.createElement("span");
            dot.className = `notif-dot ${n.type || ""}`;

            const msg = document.createElement("span");
            msg.className = "notif-msg";
            msg.textContent = n.message;

            const ts = document.createElement("span");
            ts.className = "notif-time";
            ts.textContent = _relativeTime(n.timestamp);

            item.appendChild(dot);
            item.appendChild(msg);
            item.appendChild(ts);
            dom.notifList.appendChild(item);
        });
    }

    const unread = state.notifications.filter(n => !n.read).length;
    if (unread > 0) {
        dom.notifBadge.textContent = unread > 99 ? "99+" : String(unread);
        dom.notifBadge.hidden = false;
    } else {
        dom.notifBadge.hidden = true;
    }
}

export function showTopNotice(message, noticeType, _autoHideMs) {
    state.notifications.push({
        id: Date.now() + Math.random(),
        message,
        type: noticeType || "",
        timestamp: new Date(),
        read: state.notifPanelOpen,
    });
    _renderNotifPanel();
}

// Update an existing notification in-place (matched by tag), or create it.
// Use the same tag on repeated calls to avoid flooding the list.
export function updateTopNotice(tag, message, noticeType) {
    const existing = state.notifications.find(n => n.tag === tag);
    if (existing) {
        existing.message = message;
        existing.type = noticeType || "";
        existing.timestamp = new Date();
    } else {
        state.notifications.push({
            id: Date.now() + Math.random(),
            tag,
            message,
            type: noticeType || "",
            timestamp: new Date(),
            read: state.notifPanelOpen,
        });
    }
    _renderNotifPanel();
}

export function dismissTopNotice() {
    // no-op — kept for call-site compatibility
}

export function toggleNotifPanel() {
    state.notifPanelOpen = !state.notifPanelOpen;
    dom.notifPanel.hidden = !state.notifPanelOpen;

    if (state.notifPanelOpen) {
        state.notifications.forEach(n => { n.read = true; });
        _renderNotifPanel();
    }
}

export function clearAllNotifications() {
    state.notifications = [];
    _renderNotifPanel();
}
