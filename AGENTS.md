# ExcalidrawX Agent Instructions

You are interacting with ExcalidrawX, an agent-first collaborative drawing app. This file tells you how to use it effectively.

## Server

The API runs at `http://localhost:3001`. Start it with `npm run dev` from the project root if not already running.

## Core Workflow

### 1. Create a canvas

```bash
curl -s -X POST http://localhost:3001/api/canvases \
  -H 'Content-Type: application/json' \
  -d '{"name": "My Diagram"}'
```

Returns `{ "id": "<canvas_id>", ... }`. Save the `id` for all subsequent calls.

### 2. Push elements

```bash
curl -s -X PUT http://localhost:3001/api/canvases/<canvas_id>/elements \
  -H 'Content-Type: application/json' \
  -d '{"elements": [...]}'
```

This is a **full replacement** — send the complete elements array every time. If a browser has the canvas open, it updates in real-time.

### 3. Verify your output

```bash
# Always works, no browser needed:
curl -s http://localhost:3001/api/canvases/<canvas_id>/svg -o preview.svg

# Higher fidelity if browser is open:
curl -s http://localhost:3001/api/canvases/<canvas_id>/screenshot -o preview.png
```

Use `/svg` for reliable headless verification. Use `/screenshot` when a human has the canvas open in their browser for pixel-perfect PNG output.

### 4. Read back state

```bash
curl -s http://localhost:3001/api/canvases/<canvas_id>
```

The `elements` field is a JSON string. Parse it to inspect what's on the canvas.

## Element Format

Elements follow the Excalidraw format. Every element needs at minimum:

```json
{
  "type": "rectangle",
  "id": "unique_string",
  "x": 100,
  "y": 100,
  "width": 200,
  "height": 100
}
```

### Required fields (all elements)

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `rectangle`, `ellipse`, `diamond`, `text`, `arrow`, `line`, `freedraw` |
| `id` | string | Unique identifier. Use any string. Must be unique across all elements. |
| `x` | number | X position (left edge) |
| `y` | number | Y position (top edge) |
| `width` | number | Width (not needed for `text`, `arrow`, `line`, `freedraw`) |
| `height` | number | Height (not needed for `text`, `arrow`, `line`, `freedraw`) |

### Common optional fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `strokeColor` | string | `"#1e1e1e"` | Border/stroke color (hex) |
| `backgroundColor` | string | `"transparent"` | Fill color. Use `"transparent"` for no fill. |
| `fillStyle` | string | `"solid"` | `"solid"`, `"hachure"`, `"cross-hatch"` |
| `strokeWidth` | number | `2` | Stroke thickness in pixels |
| `strokeStyle` | string | `"solid"` | `"solid"`, `"dashed"`, `"dotted"` |
| `roughness` | number | `1` | 0 = sharp, 1 = normal, 2 = extra sketchy |
| `opacity` | number | `100` | 0-100 |
| `angle` | number | `0` | Rotation in radians |
| `roundness` | object/null | `null` | `{"type": 3}` for rounded corners, `null` for sharp |

### Text elements

```json
{
  "type": "text",
  "id": "t1",
  "x": 100,
  "y": 100,
  "text": "Hello World",
  "fontSize": 20,
  "fontFamily": 1
}
```

`fontFamily`: 1 = hand-drawn (Virgil), 2 = monospace, 3 = Comic Sans.

`width` and `height` are auto-calculated by Excalidraw when rendered. You can omit them or estimate: `width ≈ text.length * fontSize * 0.5`, `height ≈ fontSize * 1.3 * lineCount`.

### Arrow and line elements

```json
{
  "type": "arrow",
  "id": "a1",
  "x": 100,
  "y": 200,
  "width": 300,
  "height": 0,
  "points": [[0, 0], [300, 0]],
  "endArrowhead": "arrow"
}
```

- `points`: array of `[dx, dy]` offsets from `(x, y)`. Minimum 2 points.
- `endArrowhead`: `"arrow"`, `"triangle"`, `"dot"`, `"bar"`, or `null`.
- `startArrowhead`: same options, for the start of the line.
- Set `width` to `max(dx)` and `height` to `max(dy)` across all points.

### Binding arrows to shapes

To visually connect an arrow to a shape:

```json
{
  "type": "arrow",
  "id": "a1",
  "x": 300,
  "y": 150,
  "width": 200,
  "height": 0,
  "points": [[0, 0], [200, 0]],
  "endArrowhead": "arrow",
  "startBinding": { "elementId": "rect1", "fixedPoint": [1, 0.5] },
  "endBinding": { "elementId": "rect2", "fixedPoint": [0, 0.5] }
}
```

`fixedPoint` is `[xRatio, yRatio]` on the target shape: `[0,0.5]` = left center, `[1,0.5]` = right center, `[0.5,0]` = top center, `[0.5,1]` = bottom center.

## Useful Color Palettes

### Stroke colors (Excalidraw defaults)
`#1e1e1e` (black), `#e03131` (red), `#2f9e44` (green), `#1971c2` (blue), `#f08c00` (orange)

### Background fills (Excalidraw defaults)
`transparent`, `#ffc9c9` (pink), `#b2f2bb` (green), `#a5d8ff` (blue), `#ffec99` (yellow)

## Patterns and Tips

### Build diagrams incrementally
Fetch current elements, add new ones, push the full array back. This avoids overwriting human edits:

```bash
# Read current state
ELEMENTS=$(curl -s http://localhost:3001/api/canvases/<id> | jq '.elements | fromjson')

# Add new element (using jq)
NEW='{"type":"rectangle","id":"new1","x":400,"y":100,"width":150,"height":80,"backgroundColor":"#a5d8ff","fillStyle":"solid"}'
UPDATED=$(echo "$ELEMENTS" | jq ". + [$NEW]")

# Push back
curl -s -X PUT http://localhost:3001/api/canvases/<id>/elements \
  -H 'Content-Type: application/json' \
  -d "{\"elements\": $UPDATED}"
```

### Coordinate system
- Origin `(0,0)` is the top-left of the infinite canvas.
- Positive X goes right, positive Y goes down.
- Place elements with enough spacing (30-50px gaps) for readability.
- A typical visible area is roughly 1200x800 pixels.

### Element IDs
Use short, descriptive IDs: `"rect_user"`, `"arrow_1"`, `"label_title"`. They must be unique within the canvas. Never reuse an ID after deleting an element.

### Flowcharts
1. Create shape elements for each node.
2. Create arrow elements connecting them with `startBinding`/`endBinding`.
3. Position shapes on a grid (e.g., 250px horizontal spacing, 150px vertical spacing).

### Visual verification loop
After pushing elements, always verify with `/svg` or `/screenshot`:
1. Push elements
2. Fetch SVG/screenshot
3. Check if the output matches intent
4. Adjust positions/sizes and push again if needed

### Canvas management
- `GET /api/canvases` — list all canvases to find existing work
- `DELETE /api/canvases/:id` — clean up when done
- `PATCH /api/canvases/:id` with `{"name": "..."}` — rename for organization

## Limitations

- The `/svg` endpoint renders a simplified version (no hand-drawn roughness, no hachure fills). Use `/screenshot` with a browser open for full fidelity.
- `PUT /elements` is a full replacement. There is no patch/diff endpoint. Always send the complete array.
- The `elements` field in GET responses is a JSON string, not a parsed array. Parse it before use.
- WebSocket is used for browser sync and screenshots. Agents should use the REST API, not WebSocket.
