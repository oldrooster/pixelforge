# PixelForge

PixelForge is a standalone image markup tool extracted from SpriteForge.

## Included in this initial cut

- Load image from disk or drag and drop
- Markup tools: brush, text, shapes (line/arrow/rect/ellipse), flood fill, color picker
- Transparency tool: region transparency fill with optional edge detection
- AI background removal via rembg
- Vertex AI image generation and inpainting
- Layer list with selection, reorder, and delete
- Undo and redo history
- Download flattened PNG

## Not yet included

- SpriteForge project library integration
- AI inpaint workflow
- Asset save and overwrite API endpoints

## Run locally

```bash
cd /home/mrmanager/pixelforge
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m flask --app app.main:app run --debug
```

Open http://127.0.0.1:5000

## Run with Docker

Build the image:

```bash
cd /home/mrmanager/pixelforge
docker build -t pixelforge:latest .
```

Run the container:

```bash
docker run --rm -p 5000:5000 pixelforge:latest
```

Then open http://127.0.0.1:5000

## Keyboard shortcuts

- B: Brush
- T: Text
- V: Select
- C: Crop
- F: Fill
- P: Color picker
- L: Shapes tool with line selected
- A: Shapes tool with arrow selected
- R: Shapes tool with rect selected
- E: Shapes tool with ellipse selected
- S: Resize tool
- X: Transparency tool
- I: Inpaint tool
- M: Toggle Inpaint mask mode (Selection/Brush)
- Enter: Apply crop or selection move (when active)
- Esc: Cancel crop or selection move (when active)
- Delete / Backspace: Delete selected layer
- Ctrl+Z: Undo
- Ctrl+Y or Ctrl+Shift+Z: Redo

Transparency tool tip:

- Choose Region fill to click an area and make it transparent.
- Enable Edge detection to better preserve boundaries.
- Choose AI background removal to use rembg on the current image.

## Vertex AI buttons

- `AI Generate`: creates a new image from a text prompt using Vertex AI.
- `AI Inpaint`: in the standalone Inpaint tool, uses the current selection (Select tool) as the edit mask and inpaints that region from a text prompt.

Credentials:

- Place your Vertex service account JSON at `vertex.json` in the project root.
- The app reads this file on the backend (Docker uses `/app/vertex.json`).

## Run with Docker Compose

Start the app:

```bash
cd /home/mrmanager/pixelforge
docker compose up --build
```

Stop and remove the container:

```bash
docker compose down
```
