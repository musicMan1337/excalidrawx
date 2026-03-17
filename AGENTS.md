# ExcalidrawX Agent Instructions

You are interacting with ExcalidrawX, an agent-first collaborative drawing app. This file tells you how to use it effectively.

## Server

The API runs at `http://localhost:3001`. Start it with `npm run dev` from the project root if not already running.

An MCP server is also available: `npm run mcp` (stdio transport). Configure in your MCP client to use ExcalidrawX tools natively.

## Core Workflow

### 1. Create a canvas

```bash
curl -s -X POST http://localhost:3001/api/canvases \
  -H 'Content-Type: application/json' \
  -d '{"name": "My Diagram"}'
```

Returns `{ "id": "<canvas_id>", ... }`. Save the `id` for all subsequent calls.

### 2. Push elements

**Full replacement:**
```bash
curl -s -X PUT http://localhost:3001/api/canvases/<id>/elements \
  -H 'Content-Type: application/json' \
  -d '{"elements": [...]}'
```

**Partial update (preferred for incremental edits):**
```bash
curl -s -X PATCH http://localhost:3001/api/canvases/<id>/elements \
  -H 'Content-Type: application/json' \
  -d '{
    "add": [{"type":"rectangle","id":"new1","x":0,"y":0,"width":100,"height":50}],
    "update": [{"id":"existing1","backgroundColor":"#ffc9c9"}],
    "remove": ["old_element_id"]
  }'
```

PATCH is safer than PUT — it won't clobber human edits. Use `add` to append, `update` to modify by ID, `remove` to delete by ID. All three fields are optional.

### 3. Verify your output

```bash
# Always works, no browser needed:
curl -s http://localhost:3001/api/canvases/<id>/svg -o preview.svg

# Higher fidelity if browser is open:
curl -s http://localhost:3001/api/canvases/<id>/screenshot -o preview.png

# Get text description (no image processing needed):
curl -s http://localhost:3001/api/canvases/<id>/describe
```

The `/describe` endpoint returns a structured JSON description of the canvas — element types, positions, connections, labels. Use this when you can't process images.

### 4. Read back state

```bash
# Full canvas (elements as JSON string):
curl -s http://localhost:3001/api/canvases/<id>

# Query specific elements:
curl -s "http://localhost:3001/api/canvases/<id>/elements?type=rectangle"
curl -s "http://localhost:3001/api/canvases/<id>/elements?id=r1,t1"
curl -s "http://localhost:3001/api/canvases/<id>/elements?near=200,150,100"
```

The query endpoint returns `{ elements: [...] }` with parsed arrays (not stringified).

## Quick Diagram Generation

Use templates to generate common diagrams from structured data instead of placing elements manually.

### Flowchart
```bash
curl -s -X POST http://localhost:3001/api/canvases/<id>/template \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "flowchart",
    "data": {
      "nodes": [{"id":"a","label":"Start"},{"id":"b","label":"Process"},{"id":"c","label":"End"}],
      "edges": [{"from":"a","to":"b","label":"next"},{"from":"b","to":"c"}],
      "direction": "horizontal"
    }
  }'
```

### Sequence diagram
```bash
curl -s -X POST http://localhost:3001/api/canvases/<id>/template \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "sequence",
    "data": {
      "actors": ["User","Server","DB"],
      "messages": [
        {"from":"User","to":"Server","label":"GET /api"},
        {"from":"Server","to":"DB","label":"SELECT *"}
      ]
    }
  }'
```

### Mindmap
```bash
curl -s -X POST http://localhost:3001/api/canvases/<id>/template \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "mindmap",
    "data": {
      "root": "Topic",
      "children": [
        {"label":"Branch A","children":[{"label":"Leaf 1"}]},
        {"label":"Branch B"}
      ]
    }
  }'
```

Templates **append** to existing elements — they don't replace the canvas.

## Layout Helpers

Auto-arrange elements without manual coordinate math:

```bash
# Align elements to the same left edge
curl -s -X POST http://localhost:3001/api/canvases/<id>/layout \
  -H 'Content-Type: application/json' \
  -d '{"action":"align","axis":"x","params":{"ids":["r1","r2","r3"],"to":"min"}}'

# Distribute evenly along Y axis
curl -s -X POST http://localhost:3001/api/canvases/<id>/layout \
  -H 'Content-Type: application/json' \
  -d '{"action":"distribute","axis":"y","params":{"ids":["r1","r2","r3"]}}'

# Arrange in a grid (3 columns, 40px gap)
curl -s -X POST http://localhost:3001/api/canvases/<id>/layout \
  -H 'Content-Type: application/json' \
  -d '{"action":"grid","params":{"ids":["a","b","c","d","e"],"columns":3,"gap":40}}'
```

## Snapshots (Versioning)

Save and restore canvas states:

```bash
# Save current state
curl -s -X POST http://localhost:3001/api/canvases/<id>/snapshots \
  -H 'Content-Type: application/json' \
  -d '{"name": "Before refactor"}'

# List snapshots
curl -s http://localhost:3001/api/canvases/<id>/snapshots

# Restore a snapshot
curl -s -X POST http://localhost:3001/api/canvases/<id>/snapshots/<snapshot_id>/restore
```

Use snapshots before making large changes. If the result is bad, restore and try again.

## Validation

Check element JSON before pushing to catch errors early:

```bash
curl -s -X POST http://localhost:3001/api/canvases/<id>/validate \
  -H 'Content-Type: application/json' \
  -d '{"elements": [...]}'
# → { "valid": true, "errors": [] }
# → { "valid": false, "errors": ["elements[0]: missing required field \"id\""] }
```

## Export

Download as `.excalidraw` file:

```bash
curl -s http://localhost:3001/api/canvases/<id>/export -o diagram.excalidraw
```

## SSE Events

Subscribe to real-time canvas changes over plain HTTP (no WebSocket needed):

```bash
curl -s -N http://localhost:3001/api/canvases/<id>/events
# Streams: data: {"type":"elements:update","elements":[...],"source":"api"}\n\n
```

Use this to watch for human edits or other agents' changes.

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
| `id` | string | Unique identifier. Must be unique across all elements. |
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
{ "type": "text", "id": "t1", "x": 100, "y": 100, "text": "Hello", "fontSize": 20, "fontFamily": 1 }
```

`fontFamily`: 1 = hand-drawn (Virgil), 2 = monospace, 3 = Comic Sans.

### Arrow and line elements

```json
{
  "type": "arrow", "id": "a1", "x": 100, "y": 200, "width": 300, "height": 0,
  "points": [[0, 0], [300, 0]], "endArrowhead": "arrow"
}
```

- `points`: array of `[dx, dy]` offsets from `(x, y)`. Minimum 2 points.
- `endArrowhead`: `"arrow"`, `"triangle"`, `"dot"`, `"bar"`, or `null`.

### Binding arrows to shapes

```json
{
  "type": "arrow", "id": "a1", "x": 300, "y": 150, "width": 200, "height": 0,
  "points": [[0, 0], [200, 0]], "endArrowhead": "arrow",
  "startBinding": { "elementId": "rect1", "fixedPoint": [1, 0.5] },
  "endBinding": { "elementId": "rect2", "fixedPoint": [0, 0.5] }
}
```

`fixedPoint` is `[xRatio, yRatio]`: `[0,0.5]` = left, `[1,0.5]` = right, `[0.5,0]` = top, `[0.5,1]` = bottom.

## Color Palettes

**Stroke:** `#1e1e1e` (black), `#e03131` (red), `#2f9e44` (green), `#1971c2` (blue), `#f08c00` (orange)

**Fill:** `transparent`, `#ffc9c9` (pink), `#b2f2bb` (green), `#a5d8ff` (blue), `#ffec99` (yellow)

## MCP Server

If your client supports MCP, configure ExcalidrawX as an MCP server for native tool access:

```json
{
  "mcpServers": {
    "excalidrawx": {
      "command": "npx",
      "args": ["tsx", "server/mcp.ts"],
      "cwd": "/path/to/excalidrawx"
    }
  }
}
```

Available tools: `create_canvas`, `list_canvases`, `get_canvas`, `set_elements`, `patch_elements`, `query_elements`, `describe_canvas`, `screenshot`, `validate_elements`, `apply_template`, `layout_elements`, `save_snapshot`, `list_snapshots`, `restore_snapshot`, `export_canvas`.

## Complete API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/canvases` | Create canvas |
| `GET` | `/api/canvases` | List canvases |
| `GET` | `/api/canvases/:id` | Get canvas |
| `PATCH` | `/api/canvases/:id` | Update name |
| `DELETE` | `/api/canvases/:id` | Delete canvas |
| `PUT` | `/api/canvases/:id/elements` | Replace all elements |
| `PATCH` | `/api/canvases/:id/elements` | Add/update/remove elements |
| `GET` | `/api/canvases/:id/elements` | Query elements (?type, ?id, ?near) |
| `GET` | `/api/canvases/:id/describe` | Text description of canvas |
| `POST` | `/api/canvases/:id/validate` | Validate element JSON |
| `GET` | `/api/canvases/:id/export` | Export as .excalidraw file |
| `GET` | `/api/canvases/:id/screenshot` | PNG (browser) or SVG (fallback) |
| `GET` | `/api/canvases/:id/svg` | Server-side SVG render |
| `POST` | `/api/canvases/:id/template` | Generate diagram from data |
| `POST` | `/api/canvases/:id/layout` | Auto-layout elements |
| `GET` | `/api/canvases/:id/events` | SSE event stream |
| `POST` | `/api/canvases/:id/snapshots` | Save snapshot |
| `GET` | `/api/canvases/:id/snapshots` | List snapshots |
| `POST` | `/api/canvases/:id/snapshots/:sid/restore` | Restore snapshot |

## Tips

- **Use PATCH over PUT** for element updates. It's safer and doesn't require fetching all elements first.
- **Use templates** for common diagrams. Much faster than placing elements manually.
- **Save snapshots** before large changes. Cheap insurance.
- **Use `/describe`** when you can't process images. It tells you what's on the canvas as structured text.
- **Use `/validate`** before pushing complex element arrays to catch errors early.
- **Coordinate system**: origin (0,0) is top-left, X goes right, Y goes down, typical viewport is ~1200x800px.
- **Element IDs**: use short descriptive strings (`"rect_user"`, `"arrow_1"`). Must be unique. Never reuse after deletion.
