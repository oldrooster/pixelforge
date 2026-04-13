# PixelForge

PixelForge is a standalone browser-based image markup and AI editing tool.

## Features

- Load image from disk or drag and drop
- Markup tools: brush, text, shapes (line/arrow/rect/ellipse), flood fill, color picker
- Crop, resize, and selection move
- Transparency tool: region fill with optional edge detection, or AI background removal via rembg
- Inpaint tool: paint a brush mask or use a selection, then run Vertex AI inpainting
- Remove Object tool: paint over an object; AI fills the area with natural background
- Img to Img (refine): use the current image as a visual reference to generate new variations
- AI Generate: create images from a text prompt via Vertex AI (returns a thumbnail gallery)
- Layer list with selection, reorder, and delete
- Zoom controls (fit, 100%, step in/out)
- Undo and redo history
- Download flattened PNG

## Not included

- SpriteForge project library integration
- Asset save and overwrite API endpoints

## Run locally

```bash
cd pixelforge
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m flask --app app.main:app run --debug
```

Open http://127.0.0.1:5000

## Run with Docker

Build the image:

```bash
docker build -t pixelforge:latest .
```

Run the container (mount your Vertex credentials):

```bash
docker run --rm -p 5000:5000 -v /path/to/vertex.json:/app/vertex.json pixelforge:latest
```

Then open http://127.0.0.1:5000

## Run with Docker Compose

```bash
docker compose up --build
```

Stop and remove the container:

```bash
docker compose down
```

The compose file mounts `./vertex.json` from the project root into the container automatically.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `VERTEX_LOCATION` | `us-central1` | Google Cloud region for Vertex AI |
| `VERTEX_GENERATE_MODEL` | `imagen-4.0-generate-001` | Model used for text-to-image generation |
| `VERTEX_INPAINT_MODEL` | `imagen-3.0-capability-001` | Model used for inpainting and refine |
| `VERTEX_CREDENTIALS_PATH` | `<project-root>/vertex.json` | Path to the Vertex AI service account JSON |

## Vertex AI credentials

Place your Vertex service account JSON somewhere on the host (e.g. `/etc/pixelforge/vertex.json`) and mount it into the container:

```bash
docker run --rm -p 5000:5000 -v /path/to/vertex.json:/app/vertex.json pixelforge:latest
```

The `docker-compose.yml` mounts `./vertex.json` at the project root by default.

## Keyboard shortcuts

| Key | Action |
|---|---|
| B | Brush |
| T | Text |
| V | Select |
| C | Crop |
| F | Fill |
| P | Color picker |
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

### Transparency

- **Region fill** — click an area to flood-fill it with transparency.
- Enable **Edge detection** to better preserve object boundaries.
- **AI removal** — sends the image to rembg to remove the background.

### Inpaint

- Choose **Selection** mask mode, draw a selection with the Select tool, then enter a prompt and click **AI Inpaint**.
- Choose **Brush mask** mode to paint directly over the area to be changed, then run **AI Inpaint**.

### Remove Object

- Paint over the object with the brush mask. Click **Remove Object** — the AI fills the painted region with natural background. No prompt needed.

### Img to Img

- Opens the current canvas as a visual reference. Describe a transformation (e.g. "paint this in watercolour", "at night in the rain") and click **Generate from Reference**. Results appear in the thumbnail gallery.

### AI Generate

- Enter a text prompt and click **AI Generate**. Up to four image candidates appear in the thumbnail gallery below the canvas. Click a thumbnail to load it, or click **✕ Delete** to remove one.
