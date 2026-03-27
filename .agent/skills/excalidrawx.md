---
model: opus
description: Start ExcalidrawX and create diagrams via MCP tools. Triggers on: excalidrawx, excalidraw, draw, create drawing, make a diagram, sketch, whiteboard
---

# ExcalidrawX

Create drawings and diagrams in ExcalidrawX using the Excalidraw MCP tools.

## Locations

- **Backend API**: `http://localhost:3001`
- **Frontend UI**: `http://localhost:5173`
- **Server entry**: `server/index.ts` (Express + WebSocket on port 3001)
- **MCP entry**: `server/mcp.ts` (stdio transport, talks to the API)

## Startup

1. Check if the backend is running: `curl -sf http://localhost:3001/api/canvases > /dev/null 2>&1`
2. If NOT running, start it in the background:
   ```bash
   npm run dev
   ```
   This launches both Express (port 3001) and Vite (port 5173) via `concurrently`.
3. Wait a few seconds and confirm the API responds before proceeding.
4. Tell the user: **View your drawings at http://localhost:5173**

## Creating the Drawing

The user's prompt is: `$ARGUMENTS`

If no prompt was provided, ask what they want to draw.

### Workflow

1. **Load the format reference** — call `mcp__excalidraw__read_me` to get the element format, color palettes, and tips. Do this every time.
2. **Design the elements** — based on the user's prompt, design the Excalidraw elements array. Think about layout, colors, grouping, and readability. Use the palettes and patterns from the reference.
3. **Render it** — call `mcp__excalidraw__create_view` with your elements JSON array.
4. **Save a checkpoint** — call `mcp__excalidraw__save_checkpoint` so the user can restore later.
5. **Report back** — tell the user what you created and where to view it.

### Design Guidelines

- Use the hand-drawn (roughness: 1) style — it's the Excalidraw aesthetic
- Pick a cohesive color palette from the reference (don't mix random colors)
- Leave generous spacing between elements (at least 40px gaps)
- Use arrows to show relationships and flow
- Group related elements visually
- Add text labels — diagrams without labels are useless
- For flowcharts/diagrams: lay out top-to-bottom or left-to-right, not scattered

## Gotchas

- The backend MUST be running for the MCP server to work — it proxies all calls to `http://localhost:3001`. If MCP tools return connection errors, the server is down.
- `create_view` takes an `elements` param that must be a JSON string (not an object). Stringify the array.
- Don't create elements with overlapping positions — offset them properly.
- Port 3001 conflicts are common. If `EADDRINUSE`, find and kill the existing process: `lsof -ti:3001 | xargs kill`
- The Excalidraw MCP (`mcp__excalidraw__*`) is the public rendering MCP. The local ExcalidrawX app has its own API at localhost:3001 for persistent canvas storage.
