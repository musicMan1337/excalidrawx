import { Router } from 'express'
import { db } from '../db.js'
import { canvases } from '../schema.js'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { broadcastToCanvas, requestScreenshot } from '../ws.js'
import { renderElementsToSvg } from '../render.js'

export const canvasRouter = Router()

// List canvases
canvasRouter.get('/canvases', (_req, res) => {
  const result = db.select().from(canvases).all()
  res.json({ canvases: result })
})

// Create canvas
canvasRouter.post('/canvases', (req, res) => {
  const { name, elements } = req.body as { name?: string; elements?: unknown[] }
  const id = nanoid(12)
  const canvas = db
    .insert(canvases)
    .values({
      id,
      name: name ?? 'Untitled',
      elements: JSON.stringify(elements ?? []),
    })
    .returning()
    .get()
  res.status(201).json(canvas)
})

// Get canvas
canvasRouter.get('/canvases/:id', (req, res): void => {
  const canvas = db.select().from(canvases).where(eq(canvases.id, req.params.id)).get()
  if (!canvas) {
    res.status(404).json({ error: 'Canvas not found' })
    return
  }
  res.json(canvas)
})

// Update canvas metadata
canvasRouter.patch('/canvases/:id', (req, res): void => {
  const { name } = req.body as { name?: string }
  const canvas = db
    .update(canvases)
    .set({ name, updatedAt: new Date().toISOString() })
    .where(eq(canvases.id, req.params.id))
    .returning()
    .get()
  res.json(canvas)
})

// Replace all elements (primary agent endpoint)
canvasRouter.put('/canvases/:id/elements', (req, res): void => {
  const { elements } = req.body as { elements?: unknown[] }
  if (!Array.isArray(elements)) {
    res.status(400).json({ error: 'elements must be an array' })
    return
  }

  const canvas = db
    .update(canvases)
    .set({
      elements: JSON.stringify(elements),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(canvases.id, req.params.id))
    .returning()
    .get()

  // Push to any connected browser clients
  broadcastToCanvas(req.params.id, elements as object[])

  res.json(canvas)
})

// Screenshot — agent visual feedback
// Tries browser client first, falls back to server-side SVG rendering
// ?format=base64|png|svg  ?width=N  ?height=N
canvasRouter.get('/canvases/:id/screenshot', async (req, res): Promise<void> => {
  const canvas = db.select().from(canvases).where(eq(canvases.id, req.params.id)).get()
  if (!canvas) {
    res.status(404).json({ error: 'Canvas not found' })
    return
  }

  const width = req.query['width'] ? parseInt(req.query['width'] as string) : undefined
  const height = req.query['height'] ? parseInt(req.query['height'] as string) : undefined
  const format = (req.query['format'] as string) || 'png'

  // Try browser-mediated screenshot first (highest fidelity)
  try {
    const dataUrl = await requestScreenshot(req.params.id, { width, height })

    if (format === 'base64') {
      res.json({ dataUrl })
      return
    }

    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
    const buffer = Buffer.from(base64, 'base64')
    res.set('Content-Type', 'image/png')
    res.send(buffer)
    return
  } catch {
    // Browser not connected — fall back to server-side SVG
  }

  // Server-side SVG rendering (no browser needed)
  const svg = renderElementsToSvg(canvas.elements, { width, height })

  if (format === 'svg' || format === 'base64') {
    if (format === 'base64') {
      const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
      res.json({ dataUrl, format: 'svg' })
      return
    }
    res.set('Content-Type', 'image/svg+xml')
    res.send(svg)
    return
  }

  // Default: return SVG (PNG conversion would require @resvg/resvg-js)
  res.set('Content-Type', 'image/svg+xml')
  res.send(svg)
})

// Get SVG render directly (agent-friendly, always works without browser)
canvasRouter.get('/canvases/:id/svg', (req, res): void => {
  const canvas = db.select().from(canvases).where(eq(canvases.id, req.params.id)).get()
  if (!canvas) {
    res.status(404).json({ error: 'Canvas not found' })
    return
  }

  const width = req.query['width'] ? parseInt(req.query['width'] as string) : undefined
  const height = req.query['height'] ? parseInt(req.query['height'] as string) : undefined

  const svg = renderElementsToSvg(canvas.elements, { width, height })
  res.set('Content-Type', 'image/svg+xml')
  res.send(svg)
})

// Delete canvas
canvasRouter.delete('/canvases/:id', (req, res): void => {
  const canvas = db.select().from(canvases).where(eq(canvases.id, req.params.id)).get()
  if (!canvas) {
    res.status(404).json({ error: 'Canvas not found' })
    return
  }
  db.delete(canvases).where(eq(canvases.id, req.params.id)).run()
  res.status(204).end()
})
