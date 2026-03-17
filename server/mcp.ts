/**
 * ExcalidrawX MCP Server
 *
 * A standalone MCP (Model Context Protocol) server that exposes ExcalidrawX
 * canvas operations as tools. Communicates via stdio using the JSON-RPC
 * Content-Length transport.
 *
 * Usage: tsx server/mcp.ts
 * Env:   EXCALIDRAWX_API=http://localhost:3001  (default)
 */

const API_BASE = process.env.EXCALIDRAWX_API || 'http://localhost:3001'

// ---------------------------------------------------------------------------
// JSON-RPC Transport (Content-Length delimited, stdio)
// ---------------------------------------------------------------------------

function sendMessage(obj: Record<string, unknown>): void {
  const body = JSON.stringify(obj)
  const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`
  process.stdout.write(header + body)
}

function sendResponse(id: string | number | null, result: unknown): void {
  sendMessage({ jsonrpc: '2.0', id, result })
}

function sendError(id: string | number | null, code: number, message: string, data?: unknown): void {
  sendMessage({ jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined && { data }) } })
}

// ---------------------------------------------------------------------------
// Stdin reader — parse Content-Length framed messages
// ---------------------------------------------------------------------------

function startReading(onMessage: (msg: JsonRpcRequest) => void): void {
  let buffer = Buffer.alloc(0)

  process.stdin.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    drainBuffer()
  })

  process.stdin.on('end', () => {
    // Nothing to do — Node will exit naturally when the event loop is empty
  })

  function drainBuffer(): void {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) return

      const headerStr = buffer.subarray(0, headerEnd).toString('utf-8')
      const match = /Content-Length:\s*(\d+)/i.exec(headerStr)
      if (!match) {
        // Malformed header — skip past it
        buffer = buffer.subarray(headerEnd + 4)
        continue
      }

      const contentLength = parseInt(match[1], 10)
      const bodyStart = headerEnd + 4
      if (buffer.length < bodyStart + contentLength) return // need more data

      const bodyStr = buffer.subarray(bodyStart, bodyStart + contentLength).toString('utf-8')
      buffer = buffer.subarray(bodyStart + contentLength)

      try {
        const msg = JSON.parse(bodyStr)
        onMessage(msg)
      } catch {
        // Ignore malformed JSON
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: string
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

interface ContentBlock {
  type: string
  text?: string
  data?: string
  mimeType?: string
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const tools: ToolDef[] = [
  {
    name: 'create_canvas',
    description: 'Create a new canvas. Returns the created canvas object with its ID.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Canvas name (defaults to "Untitled")' },
        elements: {
          type: 'array',
          items: { type: 'object' },
          description: 'Initial Excalidraw elements to place on the canvas',
        },
      },
    },
  },
  {
    name: 'list_canvases',
    description: 'List all canvases.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_canvas',
    description: 'Get full details of a canvas including its elements.',
    inputSchema: {
      type: 'object',
      properties: {
        canvas_id: { type: 'string', description: 'Canvas ID' },
      },
      required: ['canvas_id'],
    },
  },
  {
    name: 'set_elements',
    description: 'Replace all elements on a canvas. This is a full overwrite — previous elements are discarded.',
    inputSchema: {
      type: 'object',
      properties: {
        canvas_id: { type: 'string', description: 'Canvas ID' },
        elements: {
          type: 'array',
          items: { type: 'object' },
          description: 'Complete list of Excalidraw elements',
        },
      },
      required: ['canvas_id', 'elements'],
    },
  },
  {
    name: 'patch_elements',
    description: 'Add, update, or remove individual elements on a canvas without replacing everything.',
    inputSchema: {
      type: 'object',
      properties: {
        canvas_id: { type: 'string', description: 'Canvas ID' },
        add: {
          type: 'array',
          items: { type: 'object' },
          description: 'Elements to add',
        },
        update: {
          type: 'array',
          items: { type: 'object' },
          description: 'Elements to update (must include id)',
        },
        remove: {
          type: 'array',
          items: { type: 'string' },
          description: 'Element IDs to remove',
        },
      },
      required: ['canvas_id'],
    },
  },
  {
    name: 'query_elements',
    description: 'Query elements by type, ID, or spatial proximity.',
    inputSchema: {
      type: 'object',
      properties: {
        canvas_id: { type: 'string', description: 'Canvas ID' },
        type: { type: 'string', description: 'Filter by element type (e.g. "rectangle", "text", "arrow")' },
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by specific element IDs',
        },
        near: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            radius: { type: 'number' },
          },
          required: ['x', 'y', 'radius'],
          description: 'Find elements near a point within a radius',
        },
      },
      required: ['canvas_id'],
    },
  },
  {
    name: 'describe_canvas',
    description: 'Get a human-readable text description of the canvas contents.',
    inputSchema: {
      type: 'object',
      properties: {
        canvas_id: { type: 'string', description: 'Canvas ID' },
      },
      required: ['canvas_id'],
    },
  },
  {
    name: 'screenshot',
    description: 'Get a visual screenshot of the canvas. Returns either a base64-encoded image or SVG markup.',
    inputSchema: {
      type: 'object',
      properties: {
        canvas_id: { type: 'string', description: 'Canvas ID' },
        format: {
          type: 'string',
          enum: ['base64', 'svg'],
          description: 'Output format: "base64" for a PNG/SVG image content block, "svg" for raw SVG text (default: base64)',
        },
      },
      required: ['canvas_id'],
    },
  },
  {
    name: 'validate_elements',
    description: 'Validate an array of Excalidraw element JSON objects. Checks required fields and types without needing a canvas.',
    inputSchema: {
      type: 'object',
      properties: {
        elements: {
          type: 'array',
          items: { type: 'object' },
          description: 'Elements to validate',
        },
      },
      required: ['elements'],
    },
  },
  {
    name: 'apply_template',
    description: 'Generate a diagram from structured data using a template (flowchart, sequence diagram, mindmap).',
    inputSchema: {
      type: 'object',
      properties: {
        canvas_id: { type: 'string', description: 'Canvas ID to apply the template to' },
        template_type: {
          type: 'string',
          enum: ['flowchart', 'sequence', 'mindmap'],
          description: 'Type of diagram template',
        },
        data: {
          type: 'object',
          description: 'Structured data for the template (shape depends on template_type)',
        },
      },
      required: ['canvas_id', 'template_type', 'data'],
    },
  },
  {
    name: 'layout_elements',
    description: 'Auto-layout elements on the canvas (align, distribute, or arrange in a grid).',
    inputSchema: {
      type: 'object',
      properties: {
        canvas_id: { type: 'string', description: 'Canvas ID' },
        action: {
          type: 'string',
          enum: ['align', 'distribute', 'grid'],
          description: 'Layout action to perform',
        },
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Element IDs to lay out',
        },
        axis: {
          type: 'string',
          enum: ['x', 'y'],
          description: 'Axis for align/distribute actions',
        },
        params: {
          type: 'object',
          description: 'Additional layout parameters (e.g. grid columns, spacing)',
        },
      },
      required: ['canvas_id', 'action', 'ids'],
    },
  },
  {
    name: 'save_snapshot',
    description: 'Save a named snapshot of the current canvas state.',
    inputSchema: {
      type: 'object',
      properties: {
        canvas_id: { type: 'string', description: 'Canvas ID' },
        name: { type: 'string', description: 'Snapshot name (defaults to timestamp)' },
      },
      required: ['canvas_id'],
    },
  },
  {
    name: 'list_snapshots',
    description: 'List all saved snapshots for a canvas.',
    inputSchema: {
      type: 'object',
      properties: {
        canvas_id: { type: 'string', description: 'Canvas ID' },
      },
      required: ['canvas_id'],
    },
  },
  {
    name: 'restore_snapshot',
    description: 'Restore a canvas to a previously saved snapshot.',
    inputSchema: {
      type: 'object',
      properties: {
        canvas_id: { type: 'string', description: 'Canvas ID' },
        snapshot_id: { type: 'string', description: 'Snapshot ID to restore' },
      },
      required: ['canvas_id', 'snapshot_id'],
    },
  },
  {
    name: 'export_canvas',
    description: 'Export canvas as .excalidraw JSON format, suitable for importing into Excalidraw.',
    inputSchema: {
      type: 'object',
      properties: {
        canvas_id: { type: 'string', description: 'Canvas ID' },
      },
      required: ['canvas_id'],
    },
  },
]

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function apiGet(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API_BASE}${path}`)
  const text = await res.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: res.status, body }
}

async function apiPost(path: string, data?: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  })
  const text = await res.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: res.status, body }
}

async function apiPut(path: string, data: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  const text = await res.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: res.status, body }
}

async function apiPatch(path: string, data: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  const text = await res.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: res.status, body }
}

// ---------------------------------------------------------------------------
// Local validation (no API call needed)
// ---------------------------------------------------------------------------

const REQUIRED_ELEMENT_FIELDS = ['type', 'x', 'y', 'width', 'height'] as const
const VALID_ELEMENT_TYPES = [
  'rectangle', 'ellipse', 'diamond', 'line', 'arrow', 'text',
  'freedraw', 'image', 'frame', 'embeddable', 'iframe',
  'magicframe', 'selection',
]

function validateElements(elements: unknown[]): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!Array.isArray(elements)) {
    return { valid: false, errors: ['elements must be an array'] }
  }
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i] as Record<string, unknown>
    if (typeof el !== 'object' || el === null) {
      errors.push(`elements[${i}]: must be an object`)
      continue
    }
    for (const field of REQUIRED_ELEMENT_FIELDS) {
      if (el[field] === undefined) {
        errors.push(`elements[${i}]: missing required field "${field}"`)
      }
    }
    if (typeof el.type === 'string' && !VALID_ELEMENT_TYPES.includes(el.type)) {
      errors.push(`elements[${i}]: unknown type "${el.type}"`)
    }
    if (el.x !== undefined && typeof el.x !== 'number') {
      errors.push(`elements[${i}]: "x" must be a number`)
    }
    if (el.y !== undefined && typeof el.y !== 'number') {
      errors.push(`elements[${i}]: "y" must be a number`)
    }
    if (el.width !== undefined && typeof el.width !== 'number') {
      errors.push(`elements[${i}]: "width" must be a number`)
    }
    if (el.height !== undefined && typeof el.height !== 'number') {
      errors.push(`elements[${i}]: "height" must be a number`)
    }
  }
  return { valid: errors.length === 0, errors }
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

function textContent(data: unknown): ContentBlock[] {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  return [{ type: 'text', text }]
}

function imageContent(base64: string, mimeType: string): ContentBlock[] {
  return [{ type: 'image', data: base64, mimeType }]
}

function errorResult(message: string): { content: ContentBlock[]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true }
}

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<{ content: ContentBlock[]; isError?: boolean }> {
  try {
    switch (name) {
      // ---- create_canvas ----
      case 'create_canvas': {
        const { status, body } = await apiPost('/api/canvases', {
          name: args.name,
          elements: args.elements,
        })
        if (status >= 400) return errorResult(`API error ${status}: ${JSON.stringify(body)}`)
        return { content: textContent(body) }
      }

      // ---- list_canvases ----
      case 'list_canvases': {
        const { status, body } = await apiGet('/api/canvases')
        if (status >= 400) return errorResult(`API error ${status}: ${JSON.stringify(body)}`)
        return { content: textContent(body) }
      }

      // ---- get_canvas ----
      case 'get_canvas': {
        const { status, body } = await apiGet(`/api/canvases/${args.canvas_id}`)
        if (status >= 400) return errorResult(`API error ${status}: ${JSON.stringify(body)}`)
        return { content: textContent(body) }
      }

      // ---- set_elements ----
      case 'set_elements': {
        const { status, body } = await apiPut(`/api/canvases/${args.canvas_id}/elements`, {
          elements: args.elements,
        })
        if (status >= 400) return errorResult(`API error ${status}: ${JSON.stringify(body)}`)
        return { content: textContent(body) }
      }

      // ---- patch_elements ----
      case 'patch_elements': {
        const { status, body } = await apiPatch(`/api/canvases/${args.canvas_id}/elements`, {
          add: args.add,
          update: args.update,
          remove: args.remove,
        })
        if (status >= 400) return errorResult(`API error ${status}: ${JSON.stringify(body)}`)
        return { content: textContent(body) }
      }

      // ---- query_elements ----
      case 'query_elements': {
        const params = new URLSearchParams()
        if (args.type) params.set('type', args.type as string)
        if (args.ids) params.set('ids', (args.ids as string[]).join(','))
        if (args.near) {
          const near = args.near as { x: number; y: number; radius: number }
          params.set('near_x', String(near.x))
          params.set('near_y', String(near.y))
          params.set('near_radius', String(near.radius))
        }
        const qs = params.toString()
        const path = `/api/canvases/${args.canvas_id}/elements${qs ? '?' + qs : ''}`
        const { status, body } = await apiGet(path)
        if (status >= 400) return errorResult(`API error ${status}: ${JSON.stringify(body)}`)
        return { content: textContent(body) }
      }

      // ---- describe_canvas ----
      case 'describe_canvas': {
        const { status, body } = await apiGet(`/api/canvases/${args.canvas_id}/describe`)
        if (status >= 400) return errorResult(`API error ${status}: ${JSON.stringify(body)}`)
        return { content: textContent(body) }
      }

      // ---- screenshot ----
      case 'screenshot': {
        const format = (args.format as string) || 'base64'

        if (format === 'svg') {
          const { status, body } = await apiGet(`/api/canvases/${args.canvas_id}/screenshot?format=svg`)
          if (status >= 400) return errorResult(`API error ${status}: ${JSON.stringify(body)}`)
          // SVG comes back as text
          const svgText = typeof body === 'string' ? body : JSON.stringify(body)
          return { content: [{ type: 'text', text: svgText }] }
        }

        // base64 format
        const res = await fetch(`${API_BASE}/api/canvases/${args.canvas_id}/screenshot?format=base64`)
        if (res.status >= 400) {
          const errText = await res.text()
          return errorResult(`API error ${res.status}: ${errText}`)
        }
        const data = await res.json() as { dataUrl?: string; format?: string }
        if (data.dataUrl) {
          // dataUrl is like "data:image/png;base64,..." or "data:image/svg+xml;base64,..."
          const match = /^data:(image\/[^;]+);base64,(.+)$/.exec(data.dataUrl)
          if (match) {
            return { content: imageContent(match[2], match[1]) }
          }
          // Fallback: return as text
          return { content: textContent(data) }
        }
        return { content: textContent(data) }
      }

      // ---- validate_elements ----
      case 'validate_elements': {
        const result = validateElements(args.elements as unknown[])
        return { content: textContent(result), ...(result.valid ? {} : { isError: true }) }
      }

      // ---- apply_template ----
      case 'apply_template': {
        const { status, body } = await apiPost(`/api/canvases/${args.canvas_id}/template`, {
          template_type: args.template_type,
          data: args.data,
        })
        if (status >= 400) return errorResult(`API error ${status}: ${JSON.stringify(body)}`)
        return { content: textContent(body) }
      }

      // ---- layout_elements ----
      case 'layout_elements': {
        const { status, body } = await apiPost(`/api/canvases/${args.canvas_id}/layout`, {
          action: args.action,
          ids: args.ids,
          axis: args.axis,
          params: args.params,
        })
        if (status >= 400) return errorResult(`API error ${status}: ${JSON.stringify(body)}`)
        return { content: textContent(body) }
      }

      // ---- save_snapshot ----
      case 'save_snapshot': {
        const { status, body } = await apiPost(`/api/canvases/${args.canvas_id}/snapshots`, {
          name: args.name,
        })
        if (status >= 400) return errorResult(`API error ${status}: ${JSON.stringify(body)}`)
        return { content: textContent(body) }
      }

      // ---- list_snapshots ----
      case 'list_snapshots': {
        const { status, body } = await apiGet(`/api/canvases/${args.canvas_id}/snapshots`)
        if (status >= 400) return errorResult(`API error ${status}: ${JSON.stringify(body)}`)
        return { content: textContent(body) }
      }

      // ---- restore_snapshot ----
      case 'restore_snapshot': {
        const { status, body } = await apiPost(
          `/api/canvases/${args.canvas_id}/snapshots/${args.snapshot_id}/restore`,
          {},
        )
        if (status >= 400) return errorResult(`API error ${status}: ${JSON.stringify(body)}`)
        return { content: textContent(body) }
      }

      // ---- export_canvas ----
      case 'export_canvas': {
        const { status, body } = await apiGet(`/api/canvases/${args.canvas_id}/export`)
        if (status >= 400) return errorResult(`API error ${status}: ${JSON.stringify(body)}`)
        return { content: textContent(body) }
      }

      default:
        return errorResult(`Unknown tool: ${name}`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return errorResult(`Tool execution error: ${message}`)
  }
}

// ---------------------------------------------------------------------------
// MCP protocol handler
// ---------------------------------------------------------------------------

let initialized = false

async function handleMessage(msg: JsonRpcRequest): Promise<void> {
  const { id, method, params } = msg

  // Notifications (no id) — just acknowledge silently
  if (id === undefined || id === null) {
    // Handle notifications like notifications/initialized
    if (method === 'notifications/initialized') {
      // Client acknowledged initialization — nothing to do
    }
    return
  }

  switch (method) {
    case 'initialize': {
      initialized = true
      sendResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'excalidrawx',
          version: '0.1.0',
        },
      })
      break
    }

    case 'ping': {
      sendResponse(id, {})
      break
    }

    case 'tools/list': {
      if (!initialized) {
        sendError(id, -32002, 'Server not initialized')
        return
      }
      sendResponse(id, { tools })
      break
    }

    case 'tools/call': {
      if (!initialized) {
        sendError(id, -32002, 'Server not initialized')
        return
      }
      const toolName = (params as Record<string, unknown>)?.name as string
      const toolArgs = ((params as Record<string, unknown>)?.arguments ?? {}) as Record<string, unknown>

      if (!toolName) {
        sendError(id, -32602, 'Missing tool name')
        return
      }

      const toolDef = tools.find(t => t.name === toolName)
      if (!toolDef) {
        sendError(id, -32602, `Unknown tool: ${toolName}`)
        return
      }

      const result = await handleToolCall(toolName, toolArgs)
      sendResponse(id, result)
      break
    }

    default: {
      sendError(id, -32601, `Method not found: ${method}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Prevent unhandled rejection crashes
process.on('uncaughtException', (err) => {
  process.stderr.write(`[excalidrawx-mcp] Uncaught exception: ${err.message}\n`)
})
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[excalidrawx-mcp] Unhandled rejection: ${reason}\n`)
})

// Log to stderr (stdout is reserved for JSON-RPC)
process.stderr.write('[excalidrawx-mcp] Starting MCP server...\n')
process.stderr.write(`[excalidrawx-mcp] API base: ${API_BASE}\n`)

startReading((msg) => {
  handleMessage(msg).catch((err) => {
    process.stderr.write(`[excalidrawx-mcp] Error handling message: ${err}\n`)
    if (msg.id !== undefined && msg.id !== null) {
      sendError(msg.id, -32603, `Internal error: ${err instanceof Error ? err.message : String(err)}`)
    }
  })
})
