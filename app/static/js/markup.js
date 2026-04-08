(function () {
    var imageInput = document.getElementById("image-input");
    var downloadBtn = document.getElementById("download-btn");
    var emptyState = document.getElementById("empty-state");
    var canvasArea = document.querySelector(".canvas-area");
    var canvasWrap = document.getElementById("canvas-wrap");
    var canvas = document.getElementById("markup-canvas");
    var ctx = canvas.getContext("2d");

    var toolButtons = {
        brush: document.getElementById("tool-brush"),
        text: document.getElementById("tool-text"),
        line: document.getElementById("tool-line"),
        arrow: document.getElementById("tool-arrow"),
        rect: document.getElementById("tool-rect"),
        ellipse: document.getElementById("tool-ellipse"),
        fill: document.getElementById("tool-fill"),
        picker: document.getElementById("tool-picker"),
        crop: document.getElementById("tool-crop"),
        select: document.getElementById("tool-select"),
        resize: document.getElementById("tool-resize"),
        transparency: document.getElementById("tool-transparency"),
    };

    var brushSettings = document.getElementById("brush-settings");
    var fillSettings = document.getElementById("fill-settings");
    var textSettings = document.getElementById("text-settings");
    var shapeSettings = document.getElementById("shape-settings");
    var pickerSettings = document.getElementById("picker-settings");
    var cropSettings = document.getElementById("crop-settings");
    var selectSettings = document.getElementById("select-settings");
    var resizeSettings = document.getElementById("resize-settings");
    var transparencySettings = document.getElementById("transparency-settings");
    var toolContextTitle = document.getElementById("tool-context-title");
    var toolContextDescription = document.getElementById("tool-context-description");

    var brushColor = document.getElementById("brush-color");
    var brushSize = document.getElementById("brush-size");
    var brushSizeLabel = document.getElementById("brush-size-label");

    var fillColor = document.getElementById("fill-color");
    var fillTolerance = document.getElementById("fill-tolerance");
    var fillToleranceLabel = document.getElementById("fill-tolerance-label");

    var textColor = document.getElementById("text-color");
    var fontFamily = document.getElementById("font-family");
    var fontSize = document.getElementById("font-size");
    var fontSizeLabel = document.getElementById("font-size-label");

    var shapeColor = document.getElementById("shape-color");
    var shapeColorLabel = document.getElementById("shape-color-label");
    var strokeSize = document.getElementById("stroke-size");
    var strokeSizeLabel = document.getElementById("stroke-size-label");
    var shapeFillToggleWrap = document.getElementById("shape-fill-toggle-wrap");
    var shapeFillEnabled = document.getElementById("shape-fill-enabled");
    var shapeFillColor = document.getElementById("shape-fill-color");
    var pickerColorPreview = document.getElementById("picker-color-preview");
    var cropSizeLabel = document.getElementById("crop-size-label");
    var cropApplyBtn = document.getElementById("crop-apply-btn");
    var cropCancelBtn = document.getElementById("crop-cancel-btn");

    var selectionSizeLabel = document.getElementById("selection-size-label");
    var selectionApplyBtn = document.getElementById("selection-apply-btn");
    var selectionCancelBtn = document.getElementById("selection-cancel-btn");

    var resizeWidth = document.getElementById("resize-width");
    var resizeHeight = document.getElementById("resize-height");
    var resizeLockAspect = document.getElementById("resize-lock-aspect");
    var resizeApplyBtn = document.getElementById("resize-apply-btn");

    var transparencyMethodRadios = Array.prototype.slice.call(document.querySelectorAll("input[name='transparency-method']"));
    var transparencyRegionControls = document.getElementById("transparency-region-controls");
    var transparencyAiControls = document.getElementById("transparency-ai-controls");
    var transparencyTolerance = document.getElementById("transparency-tolerance");
    var transparencyToleranceLabel = document.getElementById("transparency-tolerance-label");
    var transparencyEdgeDetect = document.getElementById("transparency-edge-detect");
    var transparencyEdgeThreshold = document.getElementById("transparency-edge-threshold");
    var transparencyEdgeThresholdLabel = document.getElementById("transparency-edge-threshold-label");
    var transparencyAiApplyBtn = document.getElementById("transparency-ai-apply-btn");
    var transparencyAiStatus = document.getElementById("transparency-ai-status");

    var layersPanel = document.getElementById("layers-panel");
    var undoBtn = document.getElementById("undo-btn");
    var redoBtn = document.getElementById("redo-btn");
    var clearBtn = document.getElementById("clear-btn");

    var originalImage = null;
    var activeTool = "brush";
    var previousTool = "brush";

    var layers = [];
    var selectedLayerIndex = -1;

    var isDrawing = false;
    var dragStart = null;
    var lastX = 0;
    var lastY = 0;
    var lastMousePos = null;

    var isDragging = false;
    var dragOffset = { x: 0, y: 0 };

    var cropRect = null;
    var selectionRect = null;
    var floatingSelection = null;
    var selectionBackground = null;
    var isMovingSelection = false;
    var selectionDragOffset = { x: 0, y: 0 };
    var resizeAspectRatio = 1;

    var activeBrushCanvas = null;
    var activeBrushCtx = null;

    var undoStack = [];
    var redoStack = [];
    var MAX_UNDO = 50;
    var isAiRemovalRunning = false;

    var toolPanels = [brushSettings, fillSettings, textSettings, shapeSettings, pickerSettings, cropSettings, selectSettings, resizeSettings, transparencySettings];
    toolPanels.forEach(function (panel) {
        panel.classList.add("tool-panel");
    });

    function animatePanelEntry(panel) {
        panel.classList.remove("panel-enter");
        void panel.offsetWidth;
        panel.classList.add("panel-enter");
    }

    function setPanelVisible(panel, shouldShow) {
        var isVisible = !panel.hidden;
        if (shouldShow) {
            panel.hidden = false;
            if (!isVisible) {
                animatePanelEntry(panel);
            }
            return;
        }
        panel.hidden = true;
        panel.classList.remove("panel-enter");
    }

    function animateContextRefresh() {
        var header = toolContextTitle.parentElement;
        if (!header) {
            return;
        }
        header.classList.remove("context-refresh");
        void header.offsetWidth;
        header.classList.add("context-refresh");
    }

    function updateShapeFillVisibility() {
        shapeFillColor.hidden = !shapeFillEnabled.checked || shapeFillToggleWrap.hidden;
    }

    function updateTransparencyMethodUI() {
        var isRegion = getTransparencyMethod() === "region";
        transparencyRegionControls.hidden = !isRegion;
        transparencyAiControls.hidden = isRegion;
    }

    function getTransparencyMethod() {
        for (var i = 0; i < transparencyMethodRadios.length; i++) {
            if (transparencyMethodRadios[i].checked) {
                return transparencyMethodRadios[i].value;
            }
        }
        return "region";
    }

    function setAiStatus(message, state) {
        if (!transparencyAiStatus) {
            return;
        }
        transparencyAiStatus.textContent = message;
        transparencyAiStatus.classList.remove("running", "success", "error");
        if (state) {
            transparencyAiStatus.classList.add(state);
        }
    }

    function setAiButtonBusy(isBusy) {
        isAiRemovalRunning = isBusy;
        transparencyAiApplyBtn.disabled = isBusy;
        transparencyAiApplyBtn.textContent = isBusy ? "Working..." : "Run AI background removal";
    }

    function updateToolSettingsForActiveTool() {
        var isShapeTool = ["line", "arrow", "rect", "ellipse"].indexOf(activeTool) >= 0;
        var supportsShapeFill = ["rect", "ellipse"].indexOf(activeTool) >= 0;

        setPanelVisible(brushSettings, activeTool === "brush");
        setPanelVisible(fillSettings, activeTool === "fill");
        setPanelVisible(textSettings, activeTool === "text");
        setPanelVisible(shapeSettings, isShapeTool);
        setPanelVisible(pickerSettings, activeTool === "picker");
        setPanelVisible(cropSettings, activeTool === "crop");
        setPanelVisible(selectSettings, activeTool === "select");
        setPanelVisible(resizeSettings, activeTool === "resize");
        setPanelVisible(transparencySettings, activeTool === "transparency");

        shapeColorLabel.textContent = (activeTool === "line" || activeTool === "arrow") ? "Line color" : "Stroke color";
        shapeFillToggleWrap.hidden = !supportsShapeFill;
        if (!supportsShapeFill) {
            shapeFillEnabled.checked = false;
        }
        updateShapeFillVisibility();

        if (activeTool === "brush") {
            toolContextTitle.textContent = "Brush controls";
            toolContextDescription.textContent = "Draw freehand strokes on a new layer.";
        } else if (activeTool === "fill") {
            toolContextTitle.textContent = "Fill controls";
            toolContextDescription.textContent = "Fill contiguous pixels by color tolerance.";
        } else if (activeTool === "text") {
            toolContextTitle.textContent = "Text controls";
            toolContextDescription.textContent = "Click anywhere on the image to place text.";
        } else if (activeTool === "line") {
            toolContextTitle.textContent = "Line controls";
            toolContextDescription.textContent = "Drag to create a straight line.";
        } else if (activeTool === "arrow") {
            toolContextTitle.textContent = "Arrow controls";
            toolContextDescription.textContent = "Drag to create an arrow with direction.";
        } else if (activeTool === "rect") {
            toolContextTitle.textContent = "Rectangle controls";
            toolContextDescription.textContent = "Drag to draw a rectangle, optionally with fill.";
        } else if (activeTool === "ellipse") {
            toolContextTitle.textContent = "Ellipse controls";
            toolContextDescription.textContent = "Drag to draw an ellipse, optionally with fill.";
        } else if (activeTool === "crop") {
            toolContextTitle.textContent = "Crop controls";
            toolContextDescription.textContent = "Drag to define a crop area, then apply crop.";
        } else if (activeTool === "select") {
            toolContextTitle.textContent = "Select controls";
            toolContextDescription.textContent = "Select an area and drag it to move.";
        } else if (activeTool === "resize") {
            toolContextTitle.textContent = "Resize controls";
            toolContextDescription.textContent = "Set target width and height, then apply resize.";
        } else if (activeTool === "transparency") {
            toolContextTitle.textContent = "Transparency controls";
            toolContextDescription.textContent = "Use region fill or AI removal to make backgrounds transparent.";
        } else {
            toolContextTitle.textContent = "Picker controls";
            toolContextDescription.textContent = "Sample a color and return to your previous tool.";
        }

        animateContextRefresh();

        canvas.style.cursor = activeTool === "text" ? "text" : "crosshair";
    }

    function activateCanvas(img) {
        originalImage = img;
        canvas.width = img.width;
        canvas.height = img.height;

        activeBrushCanvas = document.createElement("canvas");
        activeBrushCanvas.width = img.width;
        activeBrushCanvas.height = img.height;
        activeBrushCtx = activeBrushCanvas.getContext("2d");

        layers = [];
        selectedLayerIndex = -1;
        undoStack = [];
        redoStack = [];

        clearCropState();
        clearSelectionState();

        render();
        pushUndo();
        renderLayersPanel();
        updateHistoryButtons();
        syncResizeInputs();

        emptyState.hidden = true;
        canvasWrap.hidden = false;
        canvasArea.classList.add("has-image");
        downloadBtn.disabled = false;
    }

    function loadImageFile(file) {
        if (!file || !file.type.startsWith("image/")) {
            return;
        }
        var reader = new FileReader();
        reader.onload = function (e) {
            var img = new Image();
            img.onload = function () {
                activateCanvas(img);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    function setTool(tool) {
        if (!toolButtons[tool]) {
            return;
        }

        if (activeTool === "crop" && tool !== "crop") {
            clearCropState();
        }
        if (activeTool === "select" && tool !== "select") {
            clearSelectionState();
        }

        if (tool !== "picker") {
            previousTool = tool;
        }

        activeTool = tool;
        Object.keys(toolButtons).forEach(function (key) {
            toolButtons[key].classList.toggle("active", key === tool);
        });
        updateToolSettingsForActiveTool();
    }

    Object.keys(toolButtons).forEach(function (name) {
        toolButtons[name].addEventListener("click", function () {
            setTool(name);
        });
    });

    brushSize.addEventListener("input", function () {
        brushSizeLabel.textContent = brushSize.value;
    });

    fillTolerance.addEventListener("input", function () {
        fillToleranceLabel.textContent = fillTolerance.value;
    });

    transparencyTolerance.addEventListener("input", function () {
        transparencyToleranceLabel.textContent = transparencyTolerance.value;
    });

    transparencyEdgeThreshold.addEventListener("input", function () {
        transparencyEdgeThresholdLabel.textContent = transparencyEdgeThreshold.value;
    });

    transparencyMethodRadios.forEach(function (radio) {
        radio.addEventListener("change", function () {
            updateTransparencyMethodUI();
        });
    });

    fontSize.addEventListener("input", function () {
        fontSizeLabel.textContent = fontSize.value;
    });

    strokeSize.addEventListener("input", function () {
        strokeSizeLabel.textContent = strokeSize.value;
    });

    shapeFillEnabled.addEventListener("change", function () {
        updateShapeFillVisibility();
    });

    function getCanvasPos(event) {
        var rect = canvas.getBoundingClientRect();
        return {
            x: (event.clientX - rect.left) * (canvas.width / rect.width),
            y: (event.clientY - rect.top) * (canvas.height / rect.height),
        };
    }

    function normalizeRect(x1, y1, x2, y2) {
        var x = Math.min(x1, x2);
        var y = Math.min(y1, y2);
        return {
            x: x,
            y: y,
            w: Math.abs(x2 - x1),
            h: Math.abs(y2 - y1),
        };
    }

    function clampRectToCanvas(rect) {
        if (!rect) {
            return null;
        }
        var x = Math.max(0, Math.floor(rect.x));
        var y = Math.max(0, Math.floor(rect.y));
        var maxW = canvas.width - x;
        var maxH = canvas.height - y;
        return {
            x: x,
            y: y,
            w: Math.min(Math.floor(rect.w), Math.max(0, maxW)),
            h: Math.min(Math.floor(rect.h), Math.max(0, maxH)),
        };
    }

    function syncResizeInputs() {
        if (!originalImage) {
            return;
        }
        resizeWidth.value = canvas.width;
        resizeHeight.value = canvas.height;
        resizeAspectRatio = canvas.width / canvas.height;
    }

    function buildCompositeCanvas() {
        var out = document.createElement("canvas");
        out.width = canvas.width;
        out.height = canvas.height;
        var octx = out.getContext("2d");
        octx.drawImage(originalImage, 0, 0);

        layers.forEach(function (layer) {
            drawLayer(octx, layer);
        });

        return out;
    }

    function replaceWithRasterCanvas(newCanvas) {
        var img = new Image();
        img.onload = function () {
            originalImage = img;
            canvas.width = img.width;
            canvas.height = img.height;

            activeBrushCanvas = document.createElement("canvas");
            activeBrushCanvas.width = img.width;
            activeBrushCanvas.height = img.height;
            activeBrushCtx = activeBrushCanvas.getContext("2d");

            layers = [];
            selectedLayerIndex = -1;
            clearCropState();
            clearSelectionState();
            render();
            renderLayersPanel();
            syncResizeInputs();
            pushUndo();
        };
        img.src = newCanvas.toDataURL("image/png");
    }

    function clearCropState() {
        cropRect = null;
        cropSizeLabel.textContent = "0 x 0";
    }

    function clearSelectionState() {
        selectionRect = null;
        floatingSelection = null;
        selectionBackground = null;
        isMovingSelection = false;
        selectionSizeLabel.textContent = "0 x 0";
    }

    function updateCropLabel(rect) {
        if (!rect) {
            cropSizeLabel.textContent = "0 x 0";
            return;
        }
        cropSizeLabel.textContent = Math.floor(rect.w) + " x " + Math.floor(rect.h);
    }

    function updateSelectionLabel(rect) {
        if (!rect) {
            selectionSizeLabel.textContent = "0 x 0";
            return;
        }
        selectionSizeLabel.textContent = Math.floor(rect.w) + " x " + Math.floor(rect.h);
    }

    function drawOverlayRect(rect, color) {
        if (!rect || rect.w <= 0 || rect.h <= 0) {
            return;
        }
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
        ctx.restore();
    }

    function pointInRect(x, y, rect) {
        return rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
    }

    function applyCrop() {
        if (!originalImage || !cropRect) {
            return;
        }
        var rect = clampRectToCanvas(cropRect);
        if (!rect || rect.w < 2 || rect.h < 2) {
            return;
        }
        var source = buildCompositeCanvas();
        var out = document.createElement("canvas");
        out.width = rect.w;
        out.height = rect.h;
        out.getContext("2d").drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
        replaceWithRasterCanvas(out);
    }

    function createFloatingSelection(rect) {
        var clamped = clampRectToCanvas(rect);
        if (!clamped || clamped.w < 2 || clamped.h < 2) {
            return;
        }
        var source = buildCompositeCanvas();

        var patch = document.createElement("canvas");
        patch.width = clamped.w;
        patch.height = clamped.h;
        patch.getContext("2d").drawImage(source, clamped.x, clamped.y, clamped.w, clamped.h, 0, 0, clamped.w, clamped.h);

        selectionBackground = document.createElement("canvas");
        selectionBackground.width = canvas.width;
        selectionBackground.height = canvas.height;
        var bctx = selectionBackground.getContext("2d");
        bctx.drawImage(source, 0, 0);
        bctx.clearRect(clamped.x, clamped.y, clamped.w, clamped.h);

        floatingSelection = {
            canvas: patch,
            x: clamped.x,
            y: clamped.y,
            w: clamped.w,
            h: clamped.h,
        };
        selectionRect = {
            x: floatingSelection.x,
            y: floatingSelection.y,
            w: floatingSelection.w,
            h: floatingSelection.h,
        };
        updateSelectionLabel(selectionRect);
    }

    function applySelectionMove() {
        if (!floatingSelection || !selectionBackground) {
            return;
        }
        var out = document.createElement("canvas");
        out.width = canvas.width;
        out.height = canvas.height;
        var octx = out.getContext("2d");
        octx.drawImage(selectionBackground, 0, 0);
        octx.drawImage(floatingSelection.canvas, Math.round(floatingSelection.x), Math.round(floatingSelection.y));
        replaceWithRasterCanvas(out);
    }

    function applyResize() {
        if (!originalImage) {
            return;
        }
        var w = parseInt(resizeWidth.value, 10);
        var h = parseInt(resizeHeight.value, 10);
        if (!w || !h || w < 1 || h < 1) {
            return;
        }
        var source = buildCompositeCanvas();
        var out = document.createElement("canvas");
        out.width = w;
        out.height = h;
        var octx = out.getContext("2d");
        octx.imageSmoothingEnabled = true;
        octx.imageSmoothingQuality = "high";
        octx.drawImage(source, 0, 0, w, h);
        replaceWithRasterCanvas(out);
    }

    function drawArrow(c, x1, y1, x2, y2, color, width) {
        var headLen = Math.max(width * 4, 10);
        var angle = Math.atan2(y2 - y1, x2 - x1);

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

    function drawLayer(c, layer) {
        c.save();
        if (layer.type === "brush") {
            var bCanvas = document.createElement("canvas");
            bCanvas.width = layer.imageData.width;
            bCanvas.height = layer.imageData.height;
            bCanvas.getContext("2d").putImageData(layer.imageData, 0, 0);
            c.drawImage(bCanvas, 0, 0);
            c.restore();
            return;
        }

        if (layer.type === "text") {
            c.fillStyle = layer.color;
            c.font = layer.fontSize + "px " + layer.fontFamily;
            c.textBaseline = "top";
            c.fillText(layer.text, layer.x, layer.y);
            c.restore();
            return;
        }

        if (layer.type === "line") {
            c.beginPath();
            c.moveTo(layer.x1, layer.y1);
            c.lineTo(layer.x2, layer.y2);
            c.strokeStyle = layer.color;
            c.lineWidth = layer.lineWidth;
            c.lineCap = "round";
            c.stroke();
            c.restore();
            return;
        }

        if (layer.type === "arrow") {
            drawArrow(c, layer.x1, layer.y1, layer.x2, layer.y2, layer.color, layer.lineWidth);
            c.restore();
            return;
        }

        if (layer.type === "rect") {
            if (layer.fill) {
                c.fillStyle = layer.fillColor;
                c.fillRect(layer.x, layer.y, layer.w, layer.h);
            }
            c.strokeStyle = layer.color;
            c.lineWidth = layer.lineWidth;
            c.strokeRect(layer.x, layer.y, layer.w, layer.h);
            c.restore();
            return;
        }

        if (layer.type === "ellipse") {
            c.beginPath();
            c.ellipse(layer.cx, layer.cy, Math.abs(layer.rx), Math.abs(layer.ry), 0, 0, Math.PI * 2);
            if (layer.fill) {
                c.fillStyle = layer.fillColor;
                c.fill();
            }
            c.strokeStyle = layer.color;
            c.lineWidth = layer.lineWidth;
            c.stroke();
            c.restore();
        }
    }

    function getLayerBounds(layer) {
        if (layer.type === "brush") {
            return null;
        }
        if (layer.type === "text") {
            ctx.save();
            ctx.font = layer.fontSize + "px " + layer.fontFamily;
            var width = ctx.measureText(layer.text).width;
            ctx.restore();
            return { x: layer.x, y: layer.y, w: width, h: layer.fontSize * 1.2 };
        }
        if (layer.type === "line" || layer.type === "arrow") {
            var minX = Math.min(layer.x1, layer.x2);
            var minY = Math.min(layer.y1, layer.y2);
            var maxX = Math.max(layer.x1, layer.x2);
            var maxY = Math.max(layer.y1, layer.y2);
            return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
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

    function hitTestLayers(x, y) {
        for (var i = layers.length - 1; i >= 0; i--) {
            var bounds = getLayerBounds(layers[i]);
            if (!bounds) {
                continue;
            }
            var pad = 6;
            if (x >= bounds.x - pad && x <= bounds.x + bounds.w + pad && y >= bounds.y - pad && y <= bounds.y + bounds.h + pad) {
                return i;
            }
        }
        return -1;
    }

    function renderSelection(layer) {
        var bounds = getLayerBounds(layer);
        if (!bounds) {
            return;
        }
        ctx.save();
        ctx.strokeStyle = "#2f9bff";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(bounds.x - 3, bounds.y - 3, bounds.w + 6, bounds.h + 6);
        ctx.setLineDash([]);
        ctx.restore();
    }

    function render() {
        if (!originalImage) {
            return;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (floatingSelection && selectionBackground) {
            ctx.drawImage(selectionBackground, 0, 0);
            ctx.drawImage(floatingSelection.canvas, Math.round(floatingSelection.x), Math.round(floatingSelection.y));
            drawOverlayRect({ x: floatingSelection.x, y: floatingSelection.y, w: floatingSelection.w, h: floatingSelection.h }, "#35d07f");
        } else {
            ctx.drawImage(originalImage, 0, 0);

            layers.forEach(function (layer, idx) {
                drawLayer(ctx, layer);
                if (idx === selectedLayerIndex) {
                    renderSelection(layer);
                }
            });
        }

        if (isDrawing && activeTool === "brush" && activeBrushCanvas) {
            ctx.drawImage(activeBrushCanvas, 0, 0);
        }

        if (activeTool === "crop" && cropRect) {
            drawOverlayRect(cropRect, "#ffd166");
        }
        if (activeTool === "select" && selectionRect && !floatingSelection) {
            drawOverlayRect(selectionRect, "#35d07f");
        }
    }

    function createShapeLayer(x1, y1, x2, y2) {
        var stroke = shapeColor.value;
        var width = parseInt(strokeSize.value, 10);
        var fill = shapeFillEnabled.checked;
        var fillCol = shapeFillColor.value;

        if (activeTool === "line") {
            return { type: "line", x1: x1, y1: y1, x2: x2, y2: y2, color: stroke, lineWidth: width };
        }
        if (activeTool === "arrow") {
            return { type: "arrow", x1: x1, y1: y1, x2: x2, y2: y2, color: stroke, lineWidth: width };
        }
        if (activeTool === "rect") {
            var rx = Math.min(x1, x2);
            var ry = Math.min(y1, y2);
            return {
                type: "rect",
                x: rx,
                y: ry,
                w: Math.abs(x2 - x1),
                h: Math.abs(y2 - y1),
                color: stroke,
                lineWidth: width,
                fill: fill,
                fillColor: fillCol,
            };
        }
        if (activeTool === "ellipse") {
            return {
                type: "ellipse",
                cx: (x1 + x2) / 2,
                cy: (y1 + y2) / 2,
                rx: Math.abs(x2 - x1) / 2,
                ry: Math.abs(y2 - y1) / 2,
                color: stroke,
                lineWidth: width,
                fill: fill,
                fillColor: fillCol,
            };
        }
        return null;
    }

    function floodFillAt(px, py) {
        var x = Math.floor(px);
        var y = Math.floor(py);
        var w = canvas.width;
        var h = canvas.height;
        if (x < 0 || x >= w || y < 0 || y >= h) {
            return;
        }

        var composite = document.createElement("canvas");
        composite.width = w;
        composite.height = h;
        var cctx = composite.getContext("2d");
        cctx.drawImage(originalImage, 0, 0);
        layers.forEach(function (layer) {
            drawLayer(cctx, layer);
        });

        var source = cctx.getImageData(0, 0, w, h).data;
        var idx = (y * w + x) * 4;
        var startR = source[idx];
        var startG = source[idx + 1];
        var startB = source[idx + 2];
        var startA = source[idx + 3];

        var hex = fillColor.value;
        var fillR = parseInt(hex.substr(1, 2), 16);
        var fillG = parseInt(hex.substr(3, 2), 16);
        var fillB = parseInt(hex.substr(5, 2), 16);

        if (startR === fillR && startG === fillG && startB === fillB && startA === 255) {
            return;
        }

        var tol = parseInt(fillTolerance.value, 10);

        var outCanvas = document.createElement("canvas");
        outCanvas.width = w;
        outCanvas.height = h;
        var outCtx = outCanvas.getContext("2d");
        var out = outCtx.getImageData(0, 0, w, h);
        var outData = out.data;

        var visited = new Uint8Array(w * h);
        var stack = [x + y * w];
        visited[x + y * w] = 1;

        while (stack.length > 0) {
            var p = stack.pop();
            var cx = p % w;
            var cy = (p - cx) / w;
            var i = p * 4;

            var dr = source[i] - startR;
            var dg = source[i + 1] - startG;
            var db = source[i + 2] - startB;
            var da = source[i + 3] - startA;
            if (Math.sqrt(dr * dr + dg * dg + db * db + da * da) <= tol) {
                outData[i] = fillR;
                outData[i + 1] = fillG;
                outData[i + 2] = fillB;
                outData[i + 3] = 255;

                if (cx > 0 && !visited[p - 1]) {
                    visited[p - 1] = 1;
                    stack.push(p - 1);
                }
                if (cx < w - 1 && !visited[p + 1]) {
                    visited[p + 1] = 1;
                    stack.push(p + 1);
                }
                if (cy > 0 && !visited[p - w]) {
                    visited[p - w] = 1;
                    stack.push(p - w);
                }
                if (cy < h - 1 && !visited[p + w]) {
                    visited[p + w] = 1;
                    stack.push(p + w);
                }
            }
        }

        outCtx.putImageData(out, 0, 0);
        layers.push({ type: "brush", imageData: outCtx.getImageData(0, 0, w, h) });
        selectedLayerIndex = layers.length - 1;
        render();
        renderLayersPanel();
        pushUndo();
    }

    function computeEdgeStrengthMap(source, w, h) {
        var edgeMap = new Uint16Array(w * h);
        var lum = new Float32Array(w * h);

        for (var i = 0, p = 0; i < lum.length; i++, p += 4) {
            lum[i] = source[p] * 0.299 + source[p + 1] * 0.587 + source[p + 2] * 0.114;
        }

        for (var y = 1; y < h - 1; y++) {
            for (var x = 1; x < w - 1; x++) {
                var idx = y * w + x;
                var gx =
                    -lum[idx - w - 1] + lum[idx - w + 1] +
                    -2 * lum[idx - 1] + 2 * lum[idx + 1] +
                    -lum[idx + w - 1] + lum[idx + w + 1];
                var gy =
                    -lum[idx - w - 1] - 2 * lum[idx - w] - lum[idx - w + 1] +
                    lum[idx + w - 1] + 2 * lum[idx + w] + lum[idx + w + 1];
                edgeMap[idx] = Math.min(255, Math.sqrt(gx * gx + gy * gy));
            }
        }

        return edgeMap;
    }

    function transparencyFillAt(px, py) {
        var x = Math.floor(px);
        var y = Math.floor(py);
        var w = canvas.width;
        var h = canvas.height;
        if (x < 0 || x >= w || y < 0 || y >= h) {
            return;
        }

        var composite = buildCompositeCanvas();
        var cctx = composite.getContext("2d");
        var imageData = cctx.getImageData(0, 0, w, h);
        var source = imageData.data;

        var seed = (y * w + x) * 4;
        var startR = source[seed];
        var startG = source[seed + 1];
        var startB = source[seed + 2];
        var startA = source[seed + 3];
        if (startA === 0) {
            return;
        }

        var tol = parseInt(transparencyTolerance.value, 10);
        var useEdgeDetect = transparencyEdgeDetect.checked;
        var edgeThreshold = parseInt(transparencyEdgeThreshold.value, 10);
        var edgeMap = useEdgeDetect ? computeEdgeStrengthMap(source, w, h) : null;

        var outCanvas = document.createElement("canvas");
        outCanvas.width = w;
        outCanvas.height = h;
        var outCtx = outCanvas.getContext("2d");
        outCtx.drawImage(composite, 0, 0);
        var out = outCtx.getImageData(0, 0, w, h);
        var outData = out.data;

        var visited = new Uint8Array(w * h);
        var stack = [x + y * w];
        visited[x + y * w] = 1;

        while (stack.length > 0) {
            var p = stack.pop();
            var cx = p % w;
            var cy = (p - cx) / w;
            var i = p * 4;

            if (useEdgeDetect && edgeMap[p] > edgeThreshold) {
                continue;
            }

            var dr = source[i] - startR;
            var dg = source[i + 1] - startG;
            var db = source[i + 2] - startB;
            var da = source[i + 3] - startA;
            if (Math.sqrt(dr * dr + dg * dg + db * db + da * da) <= tol) {
                outData[i + 3] = 0;

                if (cx > 0 && !visited[p - 1]) {
                    visited[p - 1] = 1;
                    stack.push(p - 1);
                }
                if (cx < w - 1 && !visited[p + 1]) {
                    visited[p + 1] = 1;
                    stack.push(p + 1);
                }
                if (cy > 0 && !visited[p - w]) {
                    visited[p - w] = 1;
                    stack.push(p - w);
                }
                if (cy < h - 1 && !visited[p + w]) {
                    visited[p + w] = 1;
                    stack.push(p + w);
                }
            }
        }

        outCtx.putImageData(out, 0, 0);
        replaceWithRasterCanvas(outCanvas);
    }

    async function runAiBackgroundRemoval() {
        if (isAiRemovalRunning) {
            return;
        }
        if (!originalImage) {
            setAiStatus("Load an image first.", "error");
            return;
        }

        setAiButtonBusy(true);
        setAiStatus("Preparing image...", "running");

        var longRunNotice = window.setTimeout(function () {
            setAiStatus("Still processing... first run may take a minute while models warm up.", "running");
        }, 6000);

        try {
            var blob = await flattenToBlob();
            var formData = new FormData();
            formData.append("image", blob, "pixelforge_input.png");

            setAiStatus("Uploading image to AI remover...", "running");
            var response = await fetch("/api/remove-background", {
                method: "POST",
                body: formData,
            });

            if (!response.ok) {
                var message = "AI background removal failed.";
                try {
                    var err = await response.json();
                    if (err && err.error) {
                        message = err.error;
                    }
                } catch (_ignored) {
                    // Keep generic message when response is not JSON.
                }
                setAiStatus(message, "error");
                window.alert(message);
                return;
            }

            setAiStatus("Applying AI result...", "running");
            var outBlob = await response.blob();
            var url = URL.createObjectURL(outBlob);
            await new Promise(function (resolve, reject) {
                var img = new Image();
                img.onload = function () {
                    var out = document.createElement("canvas");
                    out.width = img.width;
                    out.height = img.height;
                    out.getContext("2d").drawImage(img, 0, 0);
                    URL.revokeObjectURL(url);
                    replaceWithRasterCanvas(out);
                    resolve();
                };
                img.onerror = function () {
                    URL.revokeObjectURL(url);
                    reject(new Error("Could not decode AI output image."));
                };
                img.src = url;
            });

            setAiStatus("Background removed successfully.", "success");
        } catch (err) {
            var errorMessage = err && err.message ? err.message : "AI background removal failed.";
            setAiStatus(errorMessage, "error");
            window.alert(errorMessage);
        } finally {
            window.clearTimeout(longRunNotice);
            setAiButtonBusy(false);
        }
    }

    function pushUndo() {
        undoStack.push({
            layers: deepCopyLayers(layers),
            original: cloneImageCanvas(),
        });
        if (undoStack.length > MAX_UNDO) {
            undoStack.shift();
        }
        redoStack = [];
        updateHistoryButtons();
    }

    function deepCopyLayers(source) {
        return source.map(function (layer) {
            if (layer.type === "brush") {
                var id = layer.imageData;
                return {
                    type: "brush",
                    imageData: new ImageData(new Uint8ClampedArray(id.data), id.width, id.height),
                };
            }
            return JSON.parse(JSON.stringify(layer));
        });
    }

    function cloneImageCanvas() {
        var imgCanvas = document.createElement("canvas");
        imgCanvas.width = originalImage.width;
        imgCanvas.height = originalImage.height;
        imgCanvas.getContext("2d").drawImage(originalImage, 0, 0);
        return imgCanvas;
    }

    function restoreSnapshot(snap) {
        layers = deepCopyLayers(snap.layers);
        selectedLayerIndex = -1;

        var img = new Image();
        img.onload = function () {
            originalImage = img;
            canvas.width = img.width;
            canvas.height = img.height;

            activeBrushCanvas = document.createElement("canvas");
            activeBrushCanvas.width = img.width;
            activeBrushCanvas.height = img.height;
            activeBrushCtx = activeBrushCanvas.getContext("2d");

            render();
            renderLayersPanel();
            syncResizeInputs();
        };
        img.src = snap.original.toDataURL();
    }

    function updateHistoryButtons() {
        undoBtn.disabled = undoStack.length <= 1;
        redoBtn.disabled = redoStack.length === 0;
    }

    function flattenToBlob() {
        var out = buildCompositeCanvas();

        return new Promise(function (resolve) {
            out.toBlob(resolve, "image/png");
        });
    }

    function renderLayersPanel() {
        layersPanel.innerHTML = "";

        if (layers.length === 0) {
            layersPanel.innerHTML = "<div class='hint'>No layers yet</div>";
            return;
        }

        layers.forEach(function (layer, index) {
            var item = document.createElement("div");
            item.className = "layer-item" + (index === selectedLayerIndex ? " selected" : "");

            var title = document.createElement("span");
            title.className = "layer-title";
            if (layer.type === "brush") {
                title.textContent = "Brush";
            } else if (layer.type === "text") {
                title.textContent = "Text: " + layer.text.substring(0, 14);
            } else {
                title.textContent = layer.type;
            }
            item.appendChild(title);

            var actions = document.createElement("div");
            actions.className = "layer-actions";

            var up = document.createElement("button");
            up.className = "layer-btn";
            up.textContent = "Up";
            up.disabled = index === 0;
            up.addEventListener("click", function (event) {
                event.stopPropagation();
                if (index === 0) {
                    return;
                }
                var tmp = layers[index - 1];
                layers[index - 1] = layers[index];
                layers[index] = tmp;
                selectedLayerIndex = index - 1;
                render();
                renderLayersPanel();
                pushUndo();
            });
            actions.appendChild(up);

            var down = document.createElement("button");
            down.className = "layer-btn";
            down.textContent = "Dn";
            down.disabled = index === layers.length - 1;
            down.addEventListener("click", function (event) {
                event.stopPropagation();
                if (index >= layers.length - 1) {
                    return;
                }
                var tmp = layers[index + 1];
                layers[index + 1] = layers[index];
                layers[index] = tmp;
                selectedLayerIndex = index + 1;
                render();
                renderLayersPanel();
                pushUndo();
            });
            actions.appendChild(down);

            var del = document.createElement("button");
            del.className = "layer-btn";
            del.textContent = "Del";
            del.addEventListener("click", function (event) {
                event.stopPropagation();
                layers.splice(index, 1);
                selectedLayerIndex = -1;
                render();
                renderLayersPanel();
                pushUndo();
            });
            actions.appendChild(del);

            item.appendChild(actions);
            item.addEventListener("click", function () {
                selectedLayerIndex = index;
                render();
                renderLayersPanel();
            });

            layersPanel.appendChild(item);
        });
    }

    canvas.addEventListener("mousedown", function (event) {
        if (!originalImage) {
            return;
        }
        var pos = getCanvasPos(event);

        if (activeTool === "crop") {
            dragStart = { x: pos.x, y: pos.y };
            lastMousePos = pos;
            cropRect = null;
            updateCropLabel(cropRect);
            render();
            return;
        }

        if (activeTool === "select") {
            if (floatingSelection && pointInRect(pos.x, pos.y, floatingSelection)) {
                isMovingSelection = true;
                selectionDragOffset = { x: pos.x - floatingSelection.x, y: pos.y - floatingSelection.y };
                return;
            }
            dragStart = { x: pos.x, y: pos.y };
            lastMousePos = pos;
            selectionRect = null;
            floatingSelection = null;
            selectionBackground = null;
            updateSelectionLabel(selectionRect);
            render();
            return;
        }

        if (activeTool === "picker") {
            var px = Math.round(pos.x);
            var py = Math.round(pos.y);
            if (px >= 0 && px < canvas.width && py >= 0 && py < canvas.height) {
                var pixel = ctx.getImageData(px, py, 1, 1).data;
                var hex = "#" + ((1 << 24) | (pixel[0] << 16) | (pixel[1] << 8) | pixel[2]).toString(16).slice(1);
                brushColor.value = hex;
                fillColor.value = hex;
                textColor.value = hex;
                shapeColor.value = hex;
                pickerColorPreview.value = hex;
            }
            setTool(previousTool);
            return;
        }

        if (activeTool === "fill") {
            floodFillAt(pos.x, pos.y);
            return;
        }

        if (activeTool === "transparency" && getTransparencyMethod() === "region") {
            transparencyFillAt(pos.x, pos.y);
            return;
        }

        if (activeTool === "text") {
            var hit = hitTestLayers(pos.x, pos.y);
            if (hit >= 0 && layers[hit].type === "text") {
                selectedLayerIndex = hit;
                isDragging = true;
                dragOffset = { x: pos.x - layers[hit].x, y: pos.y - layers[hit].y };
                render();
                renderLayersPanel();
                return;
            }

            var text = window.prompt("Enter text");
            if (!text || !text.trim()) {
                return;
            }

            layers.push({
                type: "text",
                text: text.trim(),
                x: pos.x,
                y: pos.y,
                fontFamily: fontFamily.value,
                fontSize: parseInt(fontSize.value, 10),
                color: textColor.value,
            });
            selectedLayerIndex = layers.length - 1;
            render();
            renderLayersPanel();
            pushUndo();
            return;
        }

        if (activeTool === "brush") {
            isDrawing = true;
            lastX = pos.x;
            lastY = pos.y;
            activeBrushCtx.clearRect(0, 0, activeBrushCanvas.width, activeBrushCanvas.height);
            activeBrushCtx.beginPath();
            activeBrushCtx.arc(lastX, lastY, parseInt(brushSize.value, 10) / 2, 0, Math.PI * 2);
            activeBrushCtx.fillStyle = brushColor.value;
            activeBrushCtx.fill();
            render();
            return;
        }

        var hitLayer = hitTestLayers(pos.x, pos.y);
        if (hitLayer >= 0) {
            selectedLayerIndex = hitLayer;
            isDragging = true;
            var layer = layers[hitLayer];
            if (layer.type === "rect") {
                dragOffset = { x: pos.x - layer.x, y: pos.y - layer.y };
            } else if (layer.type === "ellipse") {
                dragOffset = { x: pos.x - layer.cx, y: pos.y - layer.cy };
            } else {
                dragOffset = { x: pos.x - layer.x1, y: pos.y - layer.y1 };
            }
            render();
            renderLayersPanel();
            return;
        }

        dragStart = { x: pos.x, y: pos.y };
        selectedLayerIndex = -1;
        render();
        renderLayersPanel();
    });

    canvas.addEventListener("mousemove", function (event) {
        if (!originalImage) {
            return;
        }
        var pos = getCanvasPos(event);
        lastMousePos = pos;

        if (activeTool === "crop" && dragStart) {
            cropRect = normalizeRect(dragStart.x, dragStart.y, pos.x, pos.y);
            updateCropLabel(cropRect);
            render();
            return;
        }

        if (activeTool === "select") {
            if (isMovingSelection && floatingSelection) {
                floatingSelection.x = pos.x - selectionDragOffset.x;
                floatingSelection.y = pos.y - selectionDragOffset.y;
                selectionRect = {
                    x: floatingSelection.x,
                    y: floatingSelection.y,
                    w: floatingSelection.w,
                    h: floatingSelection.h,
                };
                updateSelectionLabel(selectionRect);
                render();
                return;
            }
            if (dragStart) {
                selectionRect = normalizeRect(dragStart.x, dragStart.y, pos.x, pos.y);
                updateSelectionLabel(selectionRect);
                render();
                return;
            }
        }

        if (activeTool === "brush" && isDrawing) {
            activeBrushCtx.beginPath();
            activeBrushCtx.moveTo(lastX, lastY);
            activeBrushCtx.lineTo(pos.x, pos.y);
            activeBrushCtx.strokeStyle = brushColor.value;
            activeBrushCtx.lineWidth = parseInt(brushSize.value, 10);
            activeBrushCtx.lineCap = "round";
            activeBrushCtx.lineJoin = "round";
            activeBrushCtx.stroke();
            lastX = pos.x;
            lastY = pos.y;
            render();
            return;
        }

        if (isDragging && selectedLayerIndex >= 0) {
            var layer = layers[selectedLayerIndex];
            if (layer.type === "text") {
                layer.x = pos.x - dragOffset.x;
                layer.y = pos.y - dragOffset.y;
            } else if (layer.type === "rect") {
                layer.x = pos.x - dragOffset.x;
                layer.y = pos.y - dragOffset.y;
            } else if (layer.type === "ellipse") {
                layer.cx = pos.x - dragOffset.x;
                layer.cy = pos.y - dragOffset.y;
            } else if (layer.type === "line" || layer.type === "arrow") {
                var dx = (pos.x - dragOffset.x) - layer.x1;
                var dy = (pos.y - dragOffset.y) - layer.y1;
                layer.x1 += dx;
                layer.y1 += dy;
                layer.x2 += dx;
                layer.y2 += dy;
                dragOffset = { x: pos.x - layer.x1, y: pos.y - layer.y1 };
            }
            render();
            return;
        }

        if (dragStart && ["line", "arrow", "rect", "ellipse"].indexOf(activeTool) >= 0) {
            render();
            var preview = createShapeLayer(dragStart.x, dragStart.y, pos.x, pos.y);
            if (preview) {
                drawLayer(ctx, preview);
            }
        }
    });

    window.addEventListener("mouseup", function () {
        if (!originalImage) {
            return;
        }

        if (activeTool === "crop" && dragStart && lastMousePos) {
            cropRect = normalizeRect(dragStart.x, dragStart.y, lastMousePos.x, lastMousePos.y);
            dragStart = null;
            updateCropLabel(cropRect);
            render();
            return;
        }

        if (activeTool === "select") {
            if (isMovingSelection) {
                isMovingSelection = false;
                return;
            }
            if (dragStart && lastMousePos) {
                selectionRect = normalizeRect(dragStart.x, dragStart.y, lastMousePos.x, lastMousePos.y);
                if (selectionRect.w > 3 && selectionRect.h > 3) {
                    createFloatingSelection(selectionRect);
                }
                dragStart = null;
                render();
                return;
            }
            dragStart = null;
            return;
        }

        if (isDrawing && activeTool === "brush") {
            isDrawing = false;
            layers.push({
                type: "brush",
                imageData: activeBrushCtx.getImageData(0, 0, activeBrushCanvas.width, activeBrushCanvas.height),
            });
            selectedLayerIndex = layers.length - 1;
            activeBrushCtx.clearRect(0, 0, activeBrushCanvas.width, activeBrushCanvas.height);
            render();
            renderLayersPanel();
            pushUndo();
        }

        if (isDragging) {
            isDragging = false;
            pushUndo();
        }

        if (dragStart && lastMousePos) {
            var dx = Math.abs(lastMousePos.x - dragStart.x);
            var dy = Math.abs(lastMousePos.y - dragStart.y);
            if (dx > 3 || dy > 3) {
                var layer = createShapeLayer(dragStart.x, dragStart.y, lastMousePos.x, lastMousePos.y);
                if (layer) {
                    layers.push(layer);
                    selectedLayerIndex = layers.length - 1;
                    render();
                    renderLayersPanel();
                    pushUndo();
                }
            }
            dragStart = null;
        }
    });

    document.addEventListener("keydown", function (event) {
        var tagName = event.target && event.target.tagName ? event.target.tagName : "";
        var isTypingTarget = tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || event.target.isContentEditable;
        if (isTypingTarget) {
            return;
        }

        if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
            event.preventDefault();
            undoBtn.click();
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
            event.preventDefault();
            redoBtn.click();
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "z") {
            event.preventDefault();
            redoBtn.click();
            return;
        }
        if (event.ctrlKey || event.metaKey) {
            return;
        }

        var key = event.key.toLowerCase();

        if (key === "b") {
            setTool("brush");
            event.preventDefault();
            return;
        }
        if (key === "t") {
            setTool("text");
            event.preventDefault();
            return;
        }
        if (key === "v") {
            setTool("select");
            event.preventDefault();
            return;
        }
        if (key === "c") {
            setTool("crop");
            event.preventDefault();
            return;
        }
        if (key === "f") {
            setTool("fill");
            event.preventDefault();
            return;
        }
        if (key === "p") {
            setTool("picker");
            event.preventDefault();
            return;
        }
        if (key === "l") {
            setTool("line");
            event.preventDefault();
            return;
        }
        if (key === "a") {
            setTool("arrow");
            event.preventDefault();
            return;
        }
        if (key === "r") {
            setTool("rect");
            event.preventDefault();
            return;
        }
        if (key === "e") {
            setTool("ellipse");
            event.preventDefault();
            return;
        }
        if (key === "s") {
            setTool("resize");
            event.preventDefault();
            return;
        }
        if (key === "x") {
            setTool("transparency");
            event.preventDefault();
            return;
        }

        if (!originalImage) {
            return;
        }

        if (event.key === "Enter") {
            if (activeTool === "crop" && cropRect) {
                applyCrop();
                event.preventDefault();
                return;
            }
            if (activeTool === "select" && floatingSelection) {
                applySelectionMove();
                event.preventDefault();
                return;
            }
        }

        if (event.key === "Escape") {
            if (activeTool === "crop" && cropRect) {
                clearCropState();
                render();
                event.preventDefault();
                return;
            }
            if (activeTool === "select" && (selectionRect || floatingSelection)) {
                clearSelectionState();
                render();
                event.preventDefault();
                return;
            }
        }

        if (event.key !== "Delete" && event.key !== "Backspace") {
            return;
        }
        if (selectedLayerIndex < 0) {
            return;
        }

        event.preventDefault();
        layers.splice(selectedLayerIndex, 1);
        selectedLayerIndex = -1;
        render();
        renderLayersPanel();
        pushUndo();
    });

    undoBtn.addEventListener("click", function () {
        if (undoStack.length <= 1) {
            return;
        }
        var current = undoStack.pop();
        redoStack.push(current);
        restoreSnapshot(undoStack[undoStack.length - 1]);
        updateHistoryButtons();
    });

    redoBtn.addEventListener("click", function () {
        if (redoStack.length === 0) {
            return;
        }
        var next = redoStack.pop();
        undoStack.push(next);
        restoreSnapshot(next);
        updateHistoryButtons();
    });

    clearBtn.addEventListener("click", function () {
        if (!originalImage) {
            return;
        }
        layers = [];
        selectedLayerIndex = -1;
        render();
        renderLayersPanel();
        pushUndo();
    });

    cropApplyBtn.addEventListener("click", function () {
        applyCrop();
    });

    cropCancelBtn.addEventListener("click", function () {
        clearCropState();
        render();
    });

    selectionApplyBtn.addEventListener("click", function () {
        applySelectionMove();
    });

    selectionCancelBtn.addEventListener("click", function () {
        clearSelectionState();
        render();
    });

    resizeWidth.addEventListener("input", function () {
        if (!resizeLockAspect.checked || !resizeAspectRatio || !originalImage) {
            return;
        }
        var w = parseInt(resizeWidth.value, 10);
        if (!w || w < 1) {
            return;
        }
        resizeHeight.value = String(Math.max(1, Math.round(w / resizeAspectRatio)));
    });

    resizeHeight.addEventListener("input", function () {
        if (!resizeLockAspect.checked || !resizeAspectRatio || !originalImage) {
            return;
        }
        var h = parseInt(resizeHeight.value, 10);
        if (!h || h < 1) {
            return;
        }
        resizeWidth.value = String(Math.max(1, Math.round(h * resizeAspectRatio)));
    });

    resizeApplyBtn.addEventListener("click", function () {
        applyResize();
    });

    transparencyAiApplyBtn.addEventListener("click", async function () {
        await runAiBackgroundRemoval();
    });

    downloadBtn.addEventListener("click", async function () {
        if (!originalImage) {
            return;
        }
        var blob = await flattenToBlob();
        var url = URL.createObjectURL(blob);
        var link = document.createElement("a");
        link.href = url;
        link.download = "pixelforge_markup.png";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    });

    imageInput.addEventListener("change", function () {
        if (imageInput.files && imageInput.files[0]) {
            loadImageFile(imageInput.files[0]);
        }
    });

    emptyState.addEventListener("dragover", function (event) {
        event.preventDefault();
        emptyState.classList.add("dragging");
    });

    emptyState.addEventListener("dragleave", function () {
        emptyState.classList.remove("dragging");
    });

    emptyState.addEventListener("drop", function (event) {
        event.preventDefault();
        emptyState.classList.remove("dragging");

        if (event.dataTransfer.files && event.dataTransfer.files[0]) {
            loadImageFile(event.dataTransfer.files[0]);
        }
    });

    updateToolSettingsForActiveTool();
    updateShapeFillVisibility();
    updateTransparencyMethodUI();
})();
