# ExcalidrawX

Agent-first collaborative drawing built on [Excalidraw](https://excalidraw.com).

Agents control the canvas via REST API or MCP. Humans interact via the full Excalidraw GUI in the browser. All changes auto-save to server and sync in real-time.

## Quick Start

```bash
npm install
npm run dev
```

- **Frontend**: http://localhost:5173
- **API**: http://localhost:3001/api/canvases
- **MCP**: `npm run mcp` (stdio transport)
- **WebSocket**: ws://localhost:3001/ws?canvasId=`<id>`

## MCP Server

ExcalidrawX includes a built-in MCP (Model Context Protocol) server that exposes all canvas operations as tools. Any MCP-compatible client — Claude Code, Claude Desktop, Cursor, or custom agents — can interact with ExcalidrawX natively without writing HTTP requests.

### How it works

The MCP server is a standalone process (`server/mcp.ts`) that:

1. Communicates via **stdio** using the standard MCP JSON-RPC transport
2. Translates tool calls into HTTP requests to the ExcalidrawX REST API
3. Returns structured results (JSON, images) back to the client

The API server must be running (`npm run dev`) for the MCP server to work.

### Available tools (15)

| Tool                | Description                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `create_canvas`     | Create a new canvas. Params: `name?`, `elements?`                                        |
| `list_canvases`     | List all canvases                                                                        |
| `get_canvas`        | Get canvas details with elements. Params: `canvas_id`                                    |
| `set_elements`      | Replace all elements (full overwrite). Params: `canvas_id`, `elements`                   |
| `patch_elements`    | Add/update/remove individual elements. Params: `canvas_id`, `add?`, `update?`, `remove?` |
| `query_elements`    | Query by type, ID, or spatial proximity. Params: `canvas_id`, `type?`, `ids?`, `near?`   |
| `describe_canvas`   | Text description of canvas contents. Params: `canvas_id`                                 |
| `screenshot`        | Visual screenshot (base64 PNG or SVG). Params: `canvas_id`, `format?`                    |
| `validate_elements` | Check element JSON for errors. Params: `elements`                                        |
| `apply_template`    | Generate flowchart/sequence/mindmap. Params: `canvas_id`, `template_type`, `data`        |
| `layout_elements`   | Auto-align, distribute, or grid arrange. Params: `canvas_id`, `action`, `ids`            |
| `save_snapshot`     | Save canvas state. Params: `canvas_id`, `name?`                                          |
| `list_snapshots`    | List saved snapshots. Params: `canvas_id`                                                |
| `restore_snapshot`  | Restore a snapshot. Params: `canvas_id`, `snapshot_id`                                   |
| `export_canvas`     | Export as .excalidraw JSON. Params: `canvas_id`                                          |

### Configuration

The MCP server connects to `http://localhost:3001` by default. Override with the `EXCALIDRAWX_API` environment variable:

```bash
EXCALIDRAWX_API=http://myserver:3001 npm run mcp
```

### Claude Code

Add ExcalidrawX to your Claude Code MCP configuration. Edit `~/.claude/claude_desktop_config.json` (or your project's `.claude/settings.json`):

```json
{
  "mcpServers": {
    "excalidrawx": {
      "command": "npx",
      "args": ["tsx", "server/mcp.ts"],
      "cwd": "/absolute/path/to/excalidrawx"
    }
  }
}
```

Then in Claude Code, you can say things like:

- _"Create a canvas called Architecture Diagram"_
- _"Draw a flowchart with nodes: User, API, Database"_
- _"Take a screenshot of my canvas"_
- _"Add a red rectangle at position 100,200"_
- _"Describe what's on the canvas"_
- _"Save a snapshot before I make changes"_

Claude Code will automatically call the appropriate ExcalidrawX MCP tools.

**Prerequisites**: The API server must be running (`npm run dev` in a separate terminal). The MCP server makes HTTP requests to it — it doesn't access the database directly.

**Screenshots**: When you ask for a screenshot, the MCP server returns it as an image content block that Claude can see and reason about visually. If a browser has the canvas open, you get a high-fidelity PNG. Otherwise, you get a server-rendered SVG.

### Other MCP clients

Any client that supports the MCP stdio transport can use ExcalidrawX. The server implements the `2024-11-05` protocol version and responds to `initialize`, `tools/list`, and `tools/call` methods.

Example with Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "excalidrawx": {
      "command": "npx",
      "args": ["tsx", "server/mcp.ts"],
      "cwd": "/absolute/path/to/excalidrawx",
      "env": {
        "EXCALIDRAWX_API": "http://localhost:3001"
      }
    }
  }
}
```

## Agent Features

See [AGENTS.md](AGENTS.md) for the full agent API reference, element format spec, and usage patterns.

- **PATCH elements** — add, update, or remove individual elements without full replacement
- **Element queries** — filter by type, ID, or spatial proximity
- **Scene description** — structured text summary of canvas contents (no image processing needed)
- **Templates** — generate flowcharts, sequence diagrams, and mindmaps from structured data
- **Layout helpers** — auto-align, distribute, and grid-arrange elements
- **Snapshots** — save/restore canvas versions for safe experimentation
- **Validation** — check element JSON before pushing
- **Export** — download as `.excalidraw` file
- **SSE events** — subscribe to real-time changes over plain HTTP
- **Screenshots** — PNG via browser relay or server-side SVG (always works headless)

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

| Method   | Endpoint                                   | Description                |
| -------- | ------------------------------------------ | -------------------------- |
| `POST`   | `/api/canvases`                            | Create canvas              |
| `GET`    | `/api/canvases`                            | List canvases              |
| `GET`    | `/api/canvases/:id`                        | Get canvas                 |
| `PATCH`  | `/api/canvases/:id`                        | Update name                |
| `DELETE` | `/api/canvases/:id`                        | Delete canvas              |
| `PUT`    | `/api/canvases/:id/elements`               | Replace all elements       |
| `PATCH`  | `/api/canvases/:id/elements`               | Add/update/remove elements |
| `GET`    | `/api/canvases/:id/elements`               | Query elements             |
| `GET`    | `/api/canvases/:id/describe`               | Text description           |
| `POST`   | `/api/canvases/:id/validate`               | Validate element JSON      |
| `GET`    | `/api/canvases/:id/export`                 | Export as .excalidraw      |
| `GET`    | `/api/canvases/:id/screenshot`             | PNG or SVG screenshot      |
| `GET`    | `/api/canvases/:id/svg`                    | Server-side SVG render     |
| `POST`   | `/api/canvases/:id/template`               | Generate diagram from data |
| `POST`   | `/api/canvases/:id/layout`                 | Auto-layout elements       |
| `GET`    | `/api/canvases/:id/events`                 | SSE event stream           |
| `POST`   | `/api/canvases/:id/snapshots`              | Save snapshot              |
| `GET`    | `/api/canvases/:id/snapshots`              | List snapshots             |
| `POST`   | `/api/canvases/:id/snapshots/:sid/restore` | Restore snapshot           |

## Architecture

```
Claude Code / Agent              Browser (Excalidraw GUI)
       |                                |
       | MCP (stdio)                    | WebSocket
       v                                v
  MCP Server  ----HTTP---->  Express API Server
                              |       |       |
                         SVG Render  SQLite  Snapshots
```

## Tech Stack

- **Frontend**: Vite + React 18 + @excalidraw/excalidraw
- **Backend**: Express + ws
- **Database**: SQLite via better-sqlite3 + Drizzle ORM
- **MCP**: Standalone stdio JSON-RPC server (zero dependencies beyond the project)
- **SVG Renderer**: Server-side Excalidraw element-to-SVG converter
- **Dev**: tsx + concurrently
