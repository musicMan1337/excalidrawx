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
- **MCP**: `npm run mcp` (stdio transport for Claude Code, etc.)
- **WebSocket**: ws://localhost:3001/ws?canvasId=`<id>`

## Agent Features

See [AGENTS.md](AGENTS.md) for comprehensive agent instructions.

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
- **MCP server** — 15 tools for native integration with Claude Code and other MCP clients

## GUI Features

The browser UI is a full-featured Excalidraw editor:

- All drawing tools (Rectangle, Diamond, Ellipse, Arrow, Line, Freedraw, Text, Image, Eraser)
- Property panel (stroke/fill color, stroke width/style, sloppiness, edges, opacity, layers)
- File menu (Open, Export Image, Save To, Reset Canvas, Dark Mode, Canvas Background, Help)
- Keyboard shortcuts (R for rectangle, A for arrow, Cmd+Z undo, etc.)
- Auto-save indicator (top-right green dot)

Open a canvas at `http://localhost:5173/?canvas=<id>`.

## Architecture

```
Agent (HTTP/MCP)                Browser (WS + GUI)
     |                               |
     |   REST /api/*                  |   WS /ws?canvasId=<id>
     |   SSE /api/.../events          |
     |                               |
     +------>  Express Server  <------+
               |      |      |
          SVG Render  SQLite  Snapshots
```

## Tech Stack

- **Frontend**: Vite + React 18 + @excalidraw/excalidraw
- **Backend**: Express + ws
- **Database**: SQLite via better-sqlite3 + Drizzle ORM
- **MCP**: Standalone stdio JSON-RPC server (no SDK dependency)
- **SVG Renderer**: Server-side Excalidraw element-to-SVG converter
- **Dev**: tsx + concurrently
