import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'http'
import { db } from './db.js'
import { canvases } from './schema.js'
import { eq } from 'drizzle-orm'

// Canvas ID → connected clients
const canvasClients = new Map<string, Set<WebSocket>>()

// Pending screenshot requests
const screenshotRequests = new Map<string, {
  resolve: (dataUrl: string) => void
  reject: (err: Error) => void
}>()

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`)
    const canvasId = url.searchParams.get('canvasId')

    if (!canvasId) {
      ws.close(1008, 'canvasId query param required')
      return
    }

    if (!canvasClients.has(canvasId)) {
      canvasClients.set(canvasId, new Set())
    }
    canvasClients.get(canvasId)!.add(ws)
    console.log(`WS: client joined canvas ${canvasId} (${canvasClients.get(canvasId)!.size} total)`)

    // Send current state
    const canvas = db.select().from(canvases).where(eq(canvases.id, canvasId)).get()
    if (canvas) {
      ws.send(JSON.stringify({
        type: 'canvas:loaded',
        canvas,
      }))
    }

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        handleMessage(ws, canvasId, msg)
      } catch (err) {
        console.error('WS: invalid message', err)
      }
    })

    ws.on('close', () => {
      canvasClients.get(canvasId)?.delete(ws)
      if (canvasClients.get(canvasId)?.size === 0) {
        canvasClients.delete(canvasId)
      }
      console.log(`WS: client left canvas ${canvasId}`)
    })
  })

  return wss
}

function handleMessage(ws: WebSocket, canvasId: string, msg: any) {
  switch (msg.type) {
    case 'elements:update': {
      // Persist
      db.update(canvases)
        .set({
          elements: JSON.stringify(msg.elements),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(canvases.id, canvasId))
        .run()

      // Broadcast to other clients on this canvas
      broadcast(canvasId, {
        type: 'elements:update',
        elements: msg.elements,
        source: 'client',
      }, ws)
      break
    }

    case 'screenshot:response': {
      const pending = screenshotRequests.get(msg.requestId)
      if (pending) {
        pending.resolve(msg.dataUrl)
        screenshotRequests.delete(msg.requestId)
      }
      break
    }
  }
}

function broadcast(canvasId: string, msg: object, exclude?: WebSocket) {
  const clients = canvasClients.get(canvasId)
  if (!clients) return
  const data = JSON.stringify(msg)
  for (const client of clients) {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(data)
    }
  }
}

/** Broadcast element updates from the REST API to all WS clients */
export function broadcastToCanvas(canvasId: string, elements: object[]) {
  broadcast(canvasId, {
    type: 'elements:update',
    elements,
    source: 'api',
  })
}

/** Request a screenshot from a connected browser client */
export function requestScreenshot(
  canvasId: string,
  options?: { width?: number; height?: number },
): Promise<string> {
  const clients = canvasClients.get(canvasId)
  if (!clients || clients.size === 0) {
    return Promise.reject(
      new Error('No browser client connected to this canvas. Open it in a browser first.'),
    )
  }

  const requestId = `ss_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const client = clients.values().next().value!

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      screenshotRequests.delete(requestId)
      reject(new Error('Screenshot request timed out (10s)'))
    }, 10_000)

    screenshotRequests.set(requestId, {
      resolve: (dataUrl) => {
        clearTimeout(timeout)
        resolve(dataUrl)
      },
      reject: (err) => {
        clearTimeout(timeout)
        reject(err)
      },
    })

    client.send(JSON.stringify({
      type: 'screenshot:request',
      requestId,
      options,
    }))
  })
}
