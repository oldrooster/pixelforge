# PixelForge

PixelForge is a standalone browser-based image markup and AI editing tool powered by Google's Gemini Enterprise Agent Platform (formerly Vertex AI).

## Features

**Markup tools**
- Brush, text, shapes (line / arrow / rect / ellipse), flood fill, colour picker
- Crop, resize, and selection move
- Magic Wand — flood-select a colour region for use with Inpaint or Remove Object
- Transparency — region flood-fill with optional edge detection, or AI background removal via rembg

**AI tools** (all via Gemini Enterprise Agent Platform)
- **Inpaint** — edit a masked region using a text prompt (selection or brush mask)
- **Remove Object** — paint over an object; AI fills the area with natural background
- **Img to Img** — use the current image as a visual reference to generate new variations
- **AI Generate** — create images from a text prompt; returns a thumbnail gallery of up to 4 candidates
- **Video** — generate a video from the current image using Veo 2 (no audio) or Veo 3 (with audio)

**Workspace**
- Layer list with selection, reorder, and delete
- Thumbnail gallery for generated image candidates
- Zoom controls (fit, 100%, step in/out)
- Undo / redo history (up to 50 steps)
- Notification bell — all AI operation results are stored in a persistent history panel
- Sessions — save and reload canvas snapshots server-side (optional, requires volume mount)
- Download flattened PNG

## AI models

| Capability | Model |
|---|---|
| Text-to-image, Img to Img, Inpaint, Remove Object | `gemini-2.5-flash-image`, `gemini-3.1-flash-image-preview`, `gemini-3-pro-image-preview` |
| Image description (auto-prompt) | `gemini-2.0-flash` |
| Video generation (no audio) | `veo-2.0-generate-001` |
| Video generation (with audio) | `veo-3.0-generate-001` |
| Background removal | rembg (`u2net`, runs locally) |

> **Note**: `gemini-3.1-flash-image-preview` and `gemini-3-pro-image-preview` are routed to the `global` Vertex AI endpoint automatically; only `gemini-2.5-flash-image` uses the regional endpoint.

## Run locally

```bash
cd pixelforge
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m flask --app app.main:app run --debug
```

Open http://127.0.0.1:5000

Place `vertex.json` (your Vertex AI service account JSON) in the project root, or set `VERTEX_CREDENTIALS_PATH` to point to it.

## Run with Docker

Build the image:

```bash
docker build -t pixelforge:latest .
```

Run the container:

```bash
docker run --rm -p 5000:5000 \
  -v /path/to/vertex.json:/app/vertex.json \
  pixelforge:latest
```

Open http://127.0.0.1:5000

## Run with Docker Compose

```bash
docker compose up --build
```

Stop and remove the container:

```bash
docker compose down
```

The compose file mounts `./vertex.json` from the project root automatically.

## Session persistence

Sessions are disabled by default. To enable, uncomment the two blocks in `docker-compose.yml`:

```yaml
environment:
  SESSIONS_DIR: /app/sessions
volumes:
  - ./sessions:/app/sessions
```

Or when running with `docker run`:

```bash
docker run --rm -p 5000:5000 \
  -v /path/to/vertex.json:/app/vertex.json \
  -v /path/to/sessions:/app/sessions \
  -e SESSIONS_DIR=/app/sessions \
  pixelforge:latest
```

Sessions are stored as JSON files (one per save), each containing the flattened canvas PNG and a thumbnail. They survive container restarts as long as the host directory is mounted.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `VERTEX_CREDENTIALS_PATH` | `<project-root>/vertex.json` | Path to the Vertex AI service account JSON |
| `VERTEX_LOCATION` | `us-central1` | Google Cloud region for regional Vertex AI calls |
| `VERTEX_GENERATE_MODEL` | `gemini-2.5-flash-image` | Default model for image generation (used by Img to Img, Inpaint, Remove Object) |
| `SESSIONS_DIR` | *(empty — disabled)* | Directory for session persistence; leave empty to disable |

## Keyboard shortcuts

| Key | Action |
|---|---|
| B | Brush |
| T | Text |
| V | Select |
| C | Crop |
| F | Fill |
| P | Colour picker |
| L | Shapes — Line |
| A | Shapes — Arrow |
| R | Shapes — Rect |
| E | Shapes — Ellipse |
| S | Resize |
| X | Transparency |
| I | Inpaint |
| M | Toggle inpaint mask mode (Selection / Brush) |
| Enter | Apply crop or selection move (when active) |
| Esc | Cancel crop or selection move (when active) |
| Delete / Backspace | Delete selected layer |
| Ctrl+Z | Undo |
| Ctrl+Y or Ctrl+Shift+Z | Redo |

## Tools reference

### Inpaint

- Choose **Selection** mask mode, draw a selection with the Select tool, enter a prompt and click **AI Inpaint**.
- Choose **Brush mask** mode to paint directly over the area to be changed, then run **AI Inpaint**.

### Remove Object

- Paint over the object with the brush mask. Click **Remove Object** — the AI fills the painted region with natural background. No prompt needed.

### Img to Img

- Opens the current canvas as a visual reference. Describe a transformation (e.g. "paint this in watercolour", "at night in the rain") and click **Generate from Reference**. Results appear in the thumbnail gallery. Use the **✦ Describe** button to auto-generate a prompt from the current image.

### AI Generate

- Choose a model, aspect ratio, and number of output images (1–4). Enter a text prompt and click **Generate Images**. Candidates appear in the thumbnail strip below the canvas. Click a thumbnail to load it.

### Video

- Select the Video tool. Choose **Veo 2** (silent) or **Veo 3** (native audio generated automatically).
- Pick a duration (4s / 6s / 8s) and aspect ratio.
- Write a motion prompt describing what should happen, e.g. *"camera slowly pans right as clouds drift across the sky"*.
- Click **Generate Video**. Generation runs asynchronously (typically 1–3 minutes); progress is shown in the notification bell. When complete, a video player appears above the thumbnail strip with a Download button.

### Sessions

- Click **Sessions** in the header to open the session browser.
- Click **Save Current Session** to snapshot the current canvas (prompts for an optional name).
- Click a session thumbnail to restore it. Use the **Delete** button to remove a session.
- Sessions require `SESSIONS_DIR` to be set on the server — if not configured, a message is shown.

### Notifications

- The bell icon in the top-right header accumulates all AI operation results (success, error, in-progress).
- The red badge shows unread count; click the bell to open the history panel.
- Click **Clear all** to reset the notification list.

### Transparency

- **Region fill** — click an area to flood-fill it with transparency.
- Enable **Edge detection** to better preserve object boundaries.
- **AI removal** — sends the image to rembg (local neural network) to remove the background. The first run may take a minute while the model loads.
