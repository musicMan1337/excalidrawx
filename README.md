# ExcalidrawX

Agent-first collaborative drawing built on [Excalidraw](https://excalidraw.com).

Agents control the canvas via REST API. Humans interact via the browser GUI. Changes sync in real-time over WebSocket. Auto-saves to server on every change.

## Quick Start

```bash
npm install
npm run dev
```

- **Frontend**: http://localhost:5173
- **API**: http://localhost:3001/api/canvases
- **WebSocket**: ws://localhost:3001/ws?canvasId=`<id>`

## Agent API

All endpoints accept/return JSON. Elements use the [Excalidraw element format](https://docs.excalidraw.com/).

### Canvases

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/canvases` | Create canvas. Body: `{ name?, elements? }` |
| `GET` | `/api/canvases` | List all canvases |
| `GET` | `/api/canvases/:id` | Get canvas with elements |
| `PATCH` | `/api/canvases/:id` | Update metadata. Body: `{ name }` |
| `DELETE` | `/api/canvases/:id` | Delete canvas |

### Elements

| Method | Endpoint | Description |
|--------|----------|-------------|
| `PUT` | `/api/canvases/:id/elements` | Replace all elements. Body: `{ elements: [...] }`. Auto-broadcasts to connected browsers. |

### Visual Feedback (Screenshots & SVG)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/canvases/:id/screenshot` | PNG via browser relay, falls back to SVG if no browser connected |
| `GET` | `/api/canvases/:id/screenshot?format=base64` | Returns `{ dataUrl }` JSON |
| `GET` | `/api/canvases/:id/screenshot?format=svg` | Force SVG output (always works, no browser needed) |
| `GET` | `/api/canvases/:id/svg` | Direct SVG render from element data (always works, no browser needed) |

The screenshot endpoint tries the browser client first (highest fidelity PNG via WebSocket relay), then falls back to server-side SVG rendering. The `/svg` endpoint always uses server-side rendering.

## Agent Workflow Example

```bash
# 1. Create a canvas
curl -X POST http://localhost:3001/api/canvases \
  -H 'Content-Type: application/json' \
  -d '{"name": "My Diagram"}'
# → { "id": "abc123", ... }

# 2. Push elements
curl -X PUT http://localhost:3001/api/canvases/abc123/elements \
  -H 'Content-Type: application/json' \
  -d '{"elements": [{"type":"rectangle","id":"r1","x":100,"y":100,"width":200,"height":100}]}'

# 3. Get visual feedback (works with or without browser)
curl http://localhost:3001/api/canvases/abc123/svg -o preview.svg

# 4. Optionally open in browser for human viewing
open "http://localhost:5173/?canvas=abc123"

# 5. High-fidelity screenshot (requires browser to be open)
curl http://localhost:3001/api/canvases/abc123/screenshot -o screenshot.png
```

## WebSocket Protocol

Connect to `ws://localhost:3001/ws?canvasId=<id>`.

**Server -> Client:**
- `canvas:loaded` — initial state on connect
- `elements:update` — element changes from other clients or the API
- `screenshot:request` — asks browser to render a screenshot

**Client -> Server:**
- `elements:update` — user made changes in the GUI
- `screenshot:response` — rendered screenshot data

## Architecture

```
Agent (HTTP)                    Browser (WS + GUI)
     |                               |
     |   REST /api/*                  |   WS /ws?canvasId=<id>
     |                               |
     +------>  Express Server  <------+
               |             |
          SVG Renderer    SQLite
         (server/render)  (excalidraw.db)
```

## Tech Stack

- **Frontend**: Vite + React 18 + @excalidraw/excalidraw
- **Backend**: Express + ws
- **Database**: SQLite via better-sqlite3 + Drizzle ORM
- **SVG Renderer**: Custom server-side Excalidraw element-to-SVG converter
- **Dev**: tsx + concurrently
