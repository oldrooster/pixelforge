// Vertex AI and rembg API calls.

import { state } from "./state.js";
import { dom } from "./dom.js";
import { showTopNotice, setAiStatus, setAiButtonBusy, setVertexButtonsBusy } from "./ui.js";
import { flattenToBlob, activateCanvas, getActiveSelectionRect, clampRectToCanvas, createSelectionMaskBlob, createInpaintBrushMaskBlob, clearSelectionState, clearInpaintMask, replaceWithRasterCanvas } from "./canvas.js";
import { appendThumbSlot, saveCurrentThumbState, loadBase64AsImage, updateThumbDeleteBtn, applyBlobAsCanvas } from "./thumbs.js";

// ---------------------------------------------------------------------------
// Shared helper: append generated images to the thumbnail strip
// ---------------------------------------------------------------------------
async function applyGeneratedImages(imagesB64, successMsg) {
    saveCurrentThumbState();

    let firstNewIndex = -1;
    imagesB64.forEach(b64 => {
        const idx = appendThumbSlot("data:image/png;base64," + b64);
        if (firstNewIndex < 0) { firstNewIndex = idx; }
    });

    const firstImg = await loadBase64AsImage(imagesB64[0]);
    state.thumbSlots.forEach(s => s.el.classList.remove("selected"));
    state.activeThumbIndex = firstNewIndex;
    activateCanvas(firstImg);
    state.thumbSlots[firstNewIndex].el.classList.add("selected");
    updateThumbDeleteBtn();

    showTopNotice(successMsg, "success", 3000);
}

// ---------------------------------------------------------------------------
// Shared helper: extract error message from a failed response
// ---------------------------------------------------------------------------
async function extractErrorMessage(response, fallback) {
    try {
        const data = await response.json();
        if (data && data.error) { return data.error; }
    } catch (_) { /* response was not JSON */ }
    return fallback;
}

// ---------------------------------------------------------------------------
// AI Generate
// ---------------------------------------------------------------------------
export async function runVertexGenerate() {
    if (state.isVertexOpRunning) { return; }

    const prompt = dom.aiGeneratePromptPanel.value.trim();
    if (!prompt) {
        showTopNotice("Enter a prompt in the AI Generate panel.", "error", 4200);
        return;
    }

    const model = dom.generateModel.value;
    const activeAr = dom.aspectBtns.find(b => b.classList.contains("active"));
    const aspectRatio = activeAr ? activeAr.dataset.ar : "1:1";

    setVertexButtonsBusy(true);
    showTopNotice("Generating images with AI...", "running");
    try {
        const response = await fetch("/api/vertex/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, model, aspectRatio }),
        });

        if (!response.ok) {
            throw new Error(await extractErrorMessage(response, "AI generate failed."));
        }

        const data = await response.json();
        const images = data.images || [];
        if (!images.length) { throw new Error("No images returned by Vertex AI."); }

        await applyGeneratedImages(images, "AI generation complete. " + images.length + " images generated.");
    } catch (err) {
        showTopNotice(err?.message ?? "AI generate failed.", "error", 6500);
    } finally {
        setVertexButtonsBusy(false);
    }
}

// ---------------------------------------------------------------------------
// Image to Image (Refine)
// ---------------------------------------------------------------------------
export async function runVertexRefine() {
    if (state.isVertexOpRunning) { return; }
    if (!state.originalImage) {
        showTopNotice("Load an image first before refining.", "error", 4200);
        return;
    }

    const prompt = dom.aiRefinePromptPanel.value.trim();
    if (!prompt) {
        showTopNotice("Enter a prompt in the AI Refine panel.", "error", 4200);
        return;
    }

    setVertexButtonsBusy(true);
    showTopNotice("Refining image with AI...", "running");
    try {
        const imageBlob = await flattenToBlob();
        const formData = new FormData();
        formData.append("prompt", prompt);
        formData.append("image", imageBlob, "pixelforge_refine_input.png");

        const response = await fetch("/api/vertex/refine", { method: "POST", body: formData });

        if (!response.ok) {
            throw new Error(await extractErrorMessage(response, "AI refine failed."));
        }

        const data = await response.json();
        const images = data.images || [];
        if (!images.length) { throw new Error("No images returned by Vertex AI."); }

        await applyGeneratedImages(images, "AI refinement complete. " + images.length + " image(s) generated.");
    } catch (err) {
        showTopNotice(err?.message ?? "AI refine failed.", "error", 6500);
    } finally {
        setVertexButtonsBusy(false);
    }
}

// ---------------------------------------------------------------------------
// Inpaint
// ---------------------------------------------------------------------------
export async function runVertexInpaint() {
    if (state.isVertexOpRunning) { return; }
    if (!state.originalImage) {
        showTopNotice("Load an image first.", "error", 4200);
        return;
    }

    const maskMode = dom.inpaintMaskModeRadios.find(r => r.checked)?.value ?? "selection";
    const prompt = dom.aiInpaintPrompt.value.trim();
    if (!prompt) {
        showTopNotice("Enter an AI Inpaint prompt in the Inpaint panel.", "error", 4200);
        return;
    }

    setVertexButtonsBusy(true);
    showTopNotice("Running Vertex AI inpainting...", "running");
    try {
        const imageBlob = await flattenToBlob();
        let maskBlob;

        if (maskMode === "selection") {
            let rect = getActiveSelectionRect();
            rect = clampRectToCanvas(rect);
            if (!rect || rect.w < 3 || rect.h < 3) {
                showTopNotice("Create a selection first (Select tool), then run AI Inpaint.", "error", 5200);
                return;
            }
            maskBlob = await createSelectionMaskBlob(rect);
        } else {
            if (!state.inpaintMaskHasPaint) {
                showTopNotice("Paint a brush mask first, then run AI Inpaint.", "error", 5200);
                return;
            }
            maskBlob = await createInpaintBrushMaskBlob();
        }

        const formData = new FormData();
        formData.append("prompt", prompt);
        formData.append("image", imageBlob, "pixelforge_inpaint_input.png");
        formData.append("mask", maskBlob, "pixelforge_inpaint_mask.png");

        const response = await fetch("/api/vertex/inpaint", { method: "POST", body: formData });

        if (!response.ok) {
            throw new Error(await extractErrorMessage(response, "AI inpainting failed."));
        }

        const outBlob = await response.blob();
        await applyBlobAsCanvas(outBlob);
        clearSelectionState();
        clearInpaintMask();
        showTopNotice("AI inpainting complete.", "success", 3000);
    } catch (err) {
        showTopNotice(err?.message ?? "AI inpainting failed.", "error", 6500);
    } finally {
        setVertexButtonsBusy(false);
    }
}

// ---------------------------------------------------------------------------
// AI Upscale (F11)
// ---------------------------------------------------------------------------
export async function runAiUpscale() {
    if (state.isVertexOpRunning) { return; }
    if (!state.originalImage) {
        showTopNotice("Load an image first.", "error", 4200);
        return;
    }

    setVertexButtonsBusy(true);
    showTopNotice("Upscaling image with AI...", "running");
    try {
        const imageBlob = await flattenToBlob();
        const formData = new FormData();
        formData.append("image", imageBlob, "pixelforge_upscale_input.png");

        const response = await fetch("/api/vertex/upscale", { method: "POST", body: formData });

        if (!response.ok) {
            throw new Error(await extractErrorMessage(response, "AI upscale failed."));
        }

        const outBlob = await response.blob();
        await applyBlobAsCanvas(outBlob);
        showTopNotice("Upscale complete.", "success", 3000);
    } catch (err) {
        showTopNotice(err?.message ?? "AI upscale failed.", "error", 6500);
    } finally {
        setVertexButtonsBusy(false);
    }
}

// ---------------------------------------------------------------------------
// AI Object Removal
// ---------------------------------------------------------------------------
export async function runAiObjectRemoval() {
    if (state.isVertexOpRunning) { return; }
    if (!state.originalImage) {
        showTopNotice("Load an image first.", "error", 4200);
        return;
    }
    if (!state.inpaintMaskHasPaint) {
        showTopNotice("Paint over the object you want removed first.", "error", 5200);
        return;
    }

    setVertexButtonsBusy(true);
    showTopNotice("Removing object with AI...", "running");
    try {
        const imageBlob = await flattenToBlob();
        const maskBlob = await createInpaintBrushMaskBlob();

        const formData = new FormData();
        formData.append("image", imageBlob, "pixelforge_remove_input.png");
        formData.append("mask", maskBlob, "pixelforge_remove_mask.png");

        const response = await fetch("/api/vertex/remove", { method: "POST", body: formData });

        if (!response.ok) {
            throw new Error(await extractErrorMessage(response, "AI object removal failed."));
        }

        const outBlob = await response.blob();
        await applyBlobAsCanvas(outBlob);
        clearInpaintMask();
        showTopNotice("Object removed.", "success", 3000);
    } catch (err) {
        showTopNotice(err?.message ?? "AI object removal failed.", "error", 6500);
    } finally {
        setVertexButtonsBusy(false);
    }
}

// ---------------------------------------------------------------------------
// AI Describe / Auto-prompt (F13)
// ---------------------------------------------------------------------------
export async function runAiDescribe(targetTextarea) {
    if (state.isVertexOpRunning) { return; }
    if (!state.originalImage) {
        showTopNotice("Load an image first.", "error", 4200);
        return;
    }

    setVertexButtonsBusy(true);
    showTopNotice("Analysing image...", "running");
    try {
        const imageBlob = await flattenToBlob();
        const formData = new FormData();
        formData.append("image", imageBlob, "pixelforge_describe_input.png");

        const response = await fetch("/api/describe", { method: "POST", body: formData });

        if (!response.ok) {
            throw new Error(await extractErrorMessage(response, "AI describe failed."));
        }

        const data = await response.json();
        if (data.prompt) {
            targetTextarea.value = data.prompt;
            targetTextarea.focus();
        }
        showTopNotice("Prompt suggestion ready.", "success", 3000);
    } catch (err) {
        showTopNotice(err?.message ?? "AI describe failed.", "error", 6500);
    } finally {
        setVertexButtonsBusy(false);
    }
}

// ---------------------------------------------------------------------------
// AI Background Removal (rembg)
// ---------------------------------------------------------------------------
export async function runAiBackgroundRemoval() {
    if (state.isAiRemovalRunning) { return; }
    if (!state.originalImage) {
        setAiStatus("Load an image first.", "error");
        return;
    }

    setAiButtonBusy(true);
    setAiStatus("Preparing image...", "running");

    const longRunNotice = window.setTimeout(() => {
        setAiStatus("Still processing... first run may take a minute while models warm up.", "running");
    }, 6000);

    try {
        const blob = await flattenToBlob();
        const formData = new FormData();
        formData.append("image", blob, "pixelforge_input.png");

        setAiStatus("Uploading image to AI remover...", "running");
        const response = await fetch("/api/remove-background", { method: "POST", body: formData });

        if (!response.ok) {
            const message = await extractErrorMessage(response, "AI background removal failed.");
            setAiStatus(message, "error");
            showTopNotice(message, "error", 6500);
            return;
        }

        setAiStatus("Applying AI result...", "running");
        const outBlob = await response.blob();
        const url = URL.createObjectURL(outBlob);
        await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const out = document.createElement("canvas");
                out.width = img.width;
                out.height = img.height;
                out.getContext("2d").drawImage(img, 0, 0);
                URL.revokeObjectURL(url);
                replaceWithRasterCanvas(out);
                resolve();
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error("Could not decode AI output image."));
            };
            img.src = url;
        });

        setAiStatus("Background removed successfully.", "success");
    } catch (err) {
        const message = err?.message ?? "AI background removal failed.";
        setAiStatus(message, "error");
        showTopNotice(message, "error", 6500);
    } finally {
        window.clearTimeout(longRunNotice);
        setAiButtonBusy(false);
    }
}
