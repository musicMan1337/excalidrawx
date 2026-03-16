# ExcalidrawX

Agent-first collaborative drawing built on [Excalidraw](https://excalidraw.com).

Agents control the canvas via REST API. Humans interact via the full Excalidraw GUI in the browser. All changes auto-save to server and sync in real-time over WebSocket.

## Quick Start

```bash
npm install
npm run dev
```

- **Frontend**: http://localhost:5173
- **API**: http://localhost:3001/api/canvases
- **WebSocket**: ws://localhost:3001/ws?canvasId=`<id>`

## GUI Features

The browser UI is a full-featured Excalidraw editor:

- All drawing tools (Rectangle, Diamond, Ellipse, Arrow, Line, Freedraw, Text, Image, Eraser)
- Property panel (stroke/fill color, stroke width/style, sloppiness, edges, opacity, layers)
- File menu (Open, Export Image, Save To, Reset Canvas, Dark Mode, Canvas Background, Help)
- Keyboard shortcuts (R for rectangle, A for arrow, Cmd+Z undo, etc.)
- Auto-save indicator (top-right green dot)

Open a canvas at `http://localhost:5173/?canvas=<id>`.

## REST API

Base URL: `http://localhost:3001`

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

### Visual Feedback

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/canvases/:id/screenshot` | PNG via browser relay, auto-falls back to SVG if no browser connected |
| `GET` | `/api/canvases/:id/screenshot?format=base64` | Returns `{ dataUrl }` JSON |
| `GET` | `/api/canvases/:id/screenshot?format=svg` | Force SVG output |
| `GET` | `/api/canvases/:id/svg` | Server-side SVG render (always works, no browser needed) |

The `/svg` endpoint always works without a browser. The `/screenshot` endpoint tries the browser first for high-fidelity PNG, then falls back to server-side SVG.

## WebSocket Protocol

Connect to `ws://localhost:3001/ws?canvasId=<id>`.

**Server -> Client:**
- `canvas:loaded` — full canvas state on connect
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
- **SVG Renderer**: Server-side Excalidraw element-to-SVG converter
- **Dev**: tsx + concurrently
