// Shared mutable application state.
// All modules import this object and read/write its properties directly.
// Using a single object lets ES modules share mutable primitives via reference.
export const state = {
    originalImage: null,
    zoomLevel: 1.0,
    MIN_ZOOM: 0.05,
    MAX_ZOOM: 10.0,
    activeTool: "brush",
    previousTool: "brush",

    layers: [],
    selectedLayerIndex: -1,

    isDrawing: false,
    dragStart: null,
    lastX: 0,
    lastY: 0,
    lastMousePos: null,

    isDragging: false,
    dragOffset: { x: 0, y: 0 },

    cropRect: null,
    selectionRect: null,
    floatingSelection: null,
    selectionBackground: null,
    isMovingSelection: false,
    selectionDragOffset: { x: 0, y: 0 },
    resizeAspectRatio: 1,

    brushPoints: [],
    isPaintingInpaintMask: false,
    inpaintMaskLastX: 0,
    inpaintMaskLastY: 0,
    inpaintMaskHasPaint: false,
    activeBrushCanvas: null,
    activeBrushCtx: null,
    inpaintMaskCanvas: null,
    inpaintMaskCtx: null,

    thumbSlots: [],
    activeThumbIndex: -1,

    undoStack: [],
    redoStack: [],
    MAX_UNDO: 50,
    isAiRemovalRunning: false,
    isVertexOpRunning: false,
};
