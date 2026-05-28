// Session persistence: save/load/delete canvas sessions from the server.

import { dom } from "./dom.js";
import { state } from "./state.js";
import { showTopNotice } from "./ui.js";
import { flattenToBlob } from "./canvas.js";
import { applyBlobAsCanvas } from "./thumbs.js";

export function closeSessionModal() {
    dom.sessionsModal.hidden = true;
}

export async function openSessionBrowser() {
    dom.sessionsGrid.innerHTML = '<div class="hint">Loading sessions...</div>';
    dom.sessionsModal.hidden = false;

    try {
        const resp = await fetch("/api/sessions");
        if (resp.status === 503) {
            dom.sessionsGrid.innerHTML = '<div class="hint">Sessions storage is not configured on the server.<br>Set the <code>SESSIONS_DIR</code> environment variable to enable.</div>';
            return;
        }
        if (!resp.ok) { throw new Error(`Server error ${resp.status}`); }

        const sessions = await resp.json();
        _renderSessionsGrid(sessions);
    } catch (err) {
        dom.sessionsGrid.innerHTML = `<div class="hint">Failed to load sessions: ${err.message}</div>`;
    }
}

function _renderSessionsGrid(sessions) {
    dom.sessionsGrid.innerHTML = "";

    if (sessions.length === 0) {
        dom.sessionsGrid.innerHTML = '<div class="hint">No saved sessions yet. Save the current canvas to get started.</div>';
        return;
    }

    sessions.forEach(s => {
        const card = document.createElement("div");
        card.className = "session-card";

        const img = document.createElement("img");
        img.src = s.thumbnail_b64
            ? `data:image/jpeg;base64,${s.thumbnail_b64}`
            : "";
        img.alt = s.name;
        img.title = "Click to load this session";

        const name = document.createElement("div");
        name.className = "session-card-name";
        name.textContent = s.name;

        const date = document.createElement("div");
        date.className = "session-card-date";
        date.textContent = s.created_at
            ? new Date(s.created_at).toLocaleString()
            : "";

        const del = document.createElement("button");
        del.className = "btn btn-small session-card-delete";
        del.textContent = "Delete";
        del.addEventListener("click", async e => {
            e.stopPropagation();
            if (!confirm(`Delete session "${s.name}"?`)) { return; }
            await _deleteSession(s.id);
        });

        card.appendChild(img);
        card.appendChild(name);
        card.appendChild(date);
        card.appendChild(del);

        card.addEventListener("click", () => _loadSession(s.id, s.name));
        dom.sessionsGrid.appendChild(card);
    });
}

async function _deleteSession(id) {
    try {
        const resp = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
        if (!resp.ok) { throw new Error(`Server error ${resp.status}`); }
        showTopNotice("Session deleted.", "success", 3000);
        await openSessionBrowser();
    } catch (err) {
        showTopNotice(`Delete failed: ${err.message}`, "error", 5000);
    }
}

async function _loadSession(id, name) {
    try {
        const resp = await fetch(`/api/sessions/${id}`);
        if (!resp.ok) { throw new Error(`Server error ${resp.status}`); }
        const data = await resp.json();

        const image_b64 = data.image_b64;
        const dataUrl = image_b64.startsWith("data:") ? image_b64 : `data:image/png;base64,${image_b64}`;

        const blob = await (await fetch(dataUrl)).blob();
        await applyBlobAsCanvas(blob);
        closeSessionModal();
        showTopNotice(`Loaded session: ${name}`, "success", 3000);
    } catch (err) {
        showTopNotice(`Load failed: ${err.message}`, "error", 5000);
    }
}

export async function saveCurrentSession() {
    if (!state.originalImage) {
        showTopNotice("Load an image first before saving a session.", "error", 4000);
        return;
    }

    const name = window.prompt("Session name (leave blank for auto-name)") ?? null;
    if (name === null) { return; }

    try {
        const blob = await flattenToBlob();
        const dataUrl = await new Promise((res, rej) => {
            const reader = new FileReader();
            reader.onload = () => res(reader.result);
            reader.onerror = rej;
            reader.readAsDataURL(blob);
        });

        const resp = await fetch("/api/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: name.trim() || undefined, image_b64: dataUrl }),
        });

        if (resp.status === 503) {
            showTopNotice("Sessions storage not configured on server.", "error", 5000);
            return;
        }
        if (!resp.ok) { throw new Error(`Server error ${resp.status}`); }

        const saved = await resp.json();
        showTopNotice(`Session saved: ${saved.name}`, "success", 3000);
    } catch (err) {
        showTopNotice(`Save failed: ${err.message}`, "error", 5000);
    }
}
