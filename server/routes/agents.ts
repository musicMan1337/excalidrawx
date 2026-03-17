import { Router } from 'express'
import { db } from '../db.js'
import { canvases, snapshots } from '../schema.js'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { broadcastToCanvas, subscribeToCanvas } from '../ws.js'

export const agentRouter = Router()

// ---------------------------------------------------------------------------
// PATCH /canvases/:id/elements — partial element updates
// ---------------------------------------------------------------------------
agentRouter.patch('/canvases/:id/elements', (req, res) => {
  const canvas = db.select().from(canvases).where(eq(canvases.id, req.params.id)).get()
  if (!canvas) return res.status(404).json({ error: 'Canvas not found' })

  const { add, update, remove } = req.body as {
    add?: object[]
    update?: object[]
    remove?: string[]
  }

  let elements: any[] = JSON.parse(canvas.elements)

  // Remove elements by ID
  if (remove && remove.length > 0) {
    const removeSet = new Set(remove)
    elements = elements.filter((el: any) => !removeSet.has(el.id))
  }

  // Update elements by merging fields
  if (update && update.length > 0) {
    const updateMap = new Map(update.map((el: any) => [el.id, el]))
    elements = elements.map((el: any) => {
      const patch = updateMap.get(el.id)
      return patch ? { ...el, ...patch } : el
    })
  }

  // Add new elements
  if (add && add.length > 0) {
    elements.push(...add)
  }

  const updated = db.update(canvases)
    .set({
      elements: JSON.stringify(elements),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(canvases.id, req.params.id))
    .returning().get()

  broadcastToCanvas(req.params.id, elements)

  res.json(updated)
})

// ---------------------------------------------------------------------------
// GET /canvases/:id/elements — query elements with filters
// ---------------------------------------------------------------------------
agentRouter.get('/canvases/:id/elements', (req, res) => {
  const canvas = db.select().from(canvases).where(eq(canvases.id, req.params.id)).get()
  if (!canvas) return res.status(404).json({ error: 'Canvas not found' })

  let elements: any[] = JSON.parse(canvas.elements)

  // Filter by type
  const type = req.query.type as string | undefined
  if (type) {
    elements = elements.filter((el: any) => el.type === type)
  }

  // Filter by IDs
  const idParam = req.query.id as string | undefined
  if (idParam) {
    const ids = new Set(idParam.split(','))
    elements = elements.filter((el: any) => ids.has(el.id))
  }

  // Spatial query: near=x,y,radius
  const near = req.query.near as string | undefined
  if (near) {
    const parts = near.split(',').map(Number)
    if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
      const [cx, cy, radius] = parts
      elements = elements.filter((el: any) => {
        const elCx = (el.x ?? 0) + (el.width ?? 0) / 2
        const elCy = (el.y ?? 0) + (el.height ?? 0) / 2
        const dx = elCx - cx
        const dy = elCy - cy
        return Math.sqrt(dx * dx + dy * dy) <= radius
      })
    }
  }

  res.json({ elements })
})

// ---------------------------------------------------------------------------
// GET /canvases/:id/describe — text description for non-visual agents
// ---------------------------------------------------------------------------
agentRouter.get('/canvases/:id/describe', (req, res) => {
  const canvas = db.select().from(canvases).where(eq(canvases.id, req.params.id)).get()
  if (!canvas) return res.status(404).json({ error: 'Canvas not found' })

  const elements: any[] = JSON.parse(canvas.elements)

  if (elements.length === 0) {
    return res.json({
      summary: 'Empty canvas',
      dimensions: { width: 0, height: 0, minX: 0, minY: 0 },
      elements: [],
      connections: [],
    })
  }

  // Compute canvas bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const el of elements) {
    const x = el.x ?? 0
    const y = el.y ?? 0
    const w = el.width ?? 0
    const h = el.height ?? 0
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x + w > maxX) maxX = x + w
    if (y + h > maxY) maxY = y + h
  }
  const canvasWidth = maxX - minX
  const canvasHeight = maxY - minY

  // Helper: compute relative position label
  function getPosition(el: any): string {
    const elCx = (el.x ?? 0) + (el.width ?? 0) / 2
    const elCy = (el.y ?? 0) + (el.height ?? 0) / 2

    const thirdW = canvasWidth / 3
    const thirdH = canvasHeight / 3

    let col: string
    if (elCx - minX < thirdW) col = 'left'
    else if (elCx - minX < thirdW * 2) col = 'center'
    else col = 'right'

    let row: string
    if (elCy - minY < thirdH) row = 'top'
    else if (elCy - minY < thirdH * 2) row = 'center'
    else row = 'bottom'

    if (row === 'center' && col === 'center') return 'center'
    if (row === 'center') return col
    if (col === 'center') return row
    return `${row}-${col}`
  }

  // Build element descriptions
  const elementDescriptions = elements.map((el: any) => ({
    id: el.id,
    type: el.type,
    position: getPosition(el),
    size: `${Math.round(el.width ?? 0)}x${Math.round(el.height ?? 0)}`,
    label: el.text ?? null,
    color: el.backgroundColor ?? el.strokeColor ?? null,
  }))

  // Build connections from arrows with bindings
  const connections: { from: string; to: string; label: string | null }[] = []
  const arrows = elements.filter((el: any) => el.type === 'arrow')
  for (const arrow of arrows) {
    const fromId = arrow.startBinding?.elementId
    const toId = arrow.endBinding?.elementId
    if (fromId && toId) {
      connections.push({
        from: fromId,
        to: toId,
        label: arrow.text ?? null,
      })
    }
  }

  // Check for text labels overlapping shapes
  const textElements = elements.filter((el: any) => el.type === 'text')
  const shapeElements = elements.filter((el: any) =>
    el.type !== 'text' && el.type !== 'arrow',
  )
  for (const text of textElements) {
    const tx = text.x ?? 0
    const ty = text.y ?? 0
    for (const shape of shapeElements) {
      const sx = shape.x ?? 0
      const sy = shape.y ?? 0
      const sw = shape.width ?? 0
      const sh = shape.height ?? 0
      if (tx >= sx && tx <= sx + sw && ty >= sy && ty <= sy + sh) {
        // Text is inside this shape — update label
        const desc = elementDescriptions.find((d: any) => d.id === shape.id)
        if (desc && !desc.label) {
          desc.label = text.text ?? null
        }
      }
    }
  }

  // Build summary
  const typeCounts = new Map<string, number>()
  for (const el of elements) {
    const t = el.type ?? 'unknown'
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1)
  }
  const parts: string[] = []
  for (const [t, count] of typeCounts) {
    parts.push(`${count} ${t}${count > 1 ? 's' : ''}`)
  }
  const summary = `Canvas with ${parts.join(', ')}`

  res.json({
    summary,
    dimensions: {
      width: Math.round(canvasWidth),
      height: Math.round(canvasHeight),
      minX: Math.round(minX),
      minY: Math.round(minY),
    },
    elements: elementDescriptions,
    connections,
  })
})

// ---------------------------------------------------------------------------
// POST /canvases/:id/validate — validate element JSON
// ---------------------------------------------------------------------------
agentRouter.post('/canvases/:id/validate', (req, res) => {
  const { elements } = req.body as { elements: any[] }
  if (!Array.isArray(elements)) {
    return res.status(400).json({ valid: false, errors: ['elements must be an array'] })
  }

  const validTypes = new Set([
    'rectangle', 'ellipse', 'diamond', 'line', 'arrow',
    'text', 'freedraw', 'image', 'frame', 'embeddable',
  ])

  const errors: string[] = []
  const seenIds = new Set<string>()

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i]
    const prefix = `elements[${i}]`

    if (!el || typeof el !== 'object') {
      errors.push(`${prefix}: must be an object`)
      continue
    }

    if (!el.type) errors.push(`${prefix}: missing required field "type"`)
    else if (!validTypes.has(el.type)) errors.push(`${prefix}: invalid type "${el.type}"`)

    if (!el.id) errors.push(`${prefix}: missing required field "id"`)
    else if (seenIds.has(el.id)) errors.push(`${prefix}: duplicate id "${el.id}"`)
    else seenIds.add(el.id)

    if (el.x === undefined || el.x === null) errors.push(`${prefix}: missing required field "x"`)
    else if (typeof el.x !== 'number') errors.push(`${prefix}: "x" must be a number`)

    if (el.y === undefined || el.y === null) errors.push(`${prefix}: missing required field "y"`)
    else if (typeof el.y !== 'number') errors.push(`${prefix}: "y" must be a number`)
  }

  res.json({ valid: errors.length === 0, errors })
})

// ---------------------------------------------------------------------------
// GET /canvases/:id/export — export as .excalidraw JSON file
// ---------------------------------------------------------------------------
agentRouter.get('/canvases/:id/export', (req, res) => {
  const canvas = db.select().from(canvases).where(eq(canvases.id, req.params.id)).get()
  if (!canvas) return res.status(404).json({ error: 'Canvas not found' })

  const elements = JSON.parse(canvas.elements)
  const appState = JSON.parse(canvas.appState)

  const excalidrawFile = {
    type: 'excalidraw',
    version: 2,
    source: 'excalidrawx',
    elements,
    appState,
  }

  const filename = `${canvas.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.excalidraw`
  res.set('Content-Type', 'application/json')
  res.set('Content-Disposition', `attachment; filename="${filename}"`)
  res.json(excalidrawFile)
})

// ---------------------------------------------------------------------------
// POST /canvases/:id/layout — auto-layout helpers
// ---------------------------------------------------------------------------
agentRouter.post('/canvases/:id/layout', (req, res) => {
  const canvas = db.select().from(canvases).where(eq(canvases.id, req.params.id)).get()
  if (!canvas) return res.status(404).json({ error: 'Canvas not found' })

  const { action, axis, params } = req.body as {
    action: 'align' | 'distribute' | 'grid'
    axis?: 'x' | 'y'
    params?: any
  }

  if (!action) {
    return res.status(400).json({ error: 'action is required' })
  }

  const elements: any[] = JSON.parse(canvas.elements)
  const ids: string[] = params?.ids ?? []
  const idSet = new Set(ids)

  // Get the target elements and their indices in the full array
  const targets = elements
    .map((el: any, idx: number) => ({ el, idx }))
    .filter(({ el }: any) => idSet.has(el.id))

  if (targets.length === 0) {
    return res.status(400).json({ error: 'No matching elements found for provided ids' })
  }

  switch (action) {
    case 'align': {
      const alignAxis = axis ?? 'x'
      const alignTo = params?.to ?? 'min'

      if (alignAxis === 'x') {
        // Align left edges
        let target: number
        if (alignTo === 'min') target = Math.min(...targets.map(({ el }: any) => el.x ?? 0))
        else if (alignTo === 'max') target = Math.max(...targets.map(({ el }: any) => el.x ?? 0))
        else target = targets.reduce((sum: number, { el }: any) => sum + (el.x ?? 0), 0) / targets.length

        for (const { el, idx } of targets) {
          elements[idx] = { ...el, x: target }
        }
      } else {
        // Align top edges
        let target: number
        if (alignTo === 'min') target = Math.min(...targets.map(({ el }: any) => el.y ?? 0))
        else if (alignTo === 'max') target = Math.max(...targets.map(({ el }: any) => el.y ?? 0))
        else target = targets.reduce((sum: number, { el }: any) => sum + (el.y ?? 0), 0) / targets.length

        for (const { el, idx } of targets) {
          elements[idx] = { ...el, y: target }
        }
      }
      break
    }

    case 'distribute': {
      const distAxis = axis ?? 'x'

      if (targets.length < 3) {
        return res.status(400).json({ error: 'distribute requires at least 3 elements' })
      }

      if (distAxis === 'x') {
        const sorted = [...targets].sort((a, b) => (a.el.x ?? 0) - (b.el.x ?? 0))
        const first = sorted[0].el.x ?? 0
        const last = sorted[sorted.length - 1].el.x ?? 0
        const step = (last - first) / (sorted.length - 1)

        for (let i = 0; i < sorted.length; i++) {
          const { el, idx } = sorted[i]
          elements[idx] = { ...el, x: first + step * i }
        }
      } else {
        const sorted = [...targets].sort((a, b) => (a.el.y ?? 0) - (b.el.y ?? 0))
        const first = sorted[0].el.y ?? 0
        const last = sorted[sorted.length - 1].el.y ?? 0
        const step = (last - first) / (sorted.length - 1)

        for (let i = 0; i < sorted.length; i++) {
          const { el, idx } = sorted[i]
          elements[idx] = { ...el, y: first + step * i }
        }
      }
      break
    }

    case 'grid': {
      const columns = params?.columns ?? 3
      const gap = params?.gap ?? 50

      // Find max element dimensions for uniform grid cells
      let maxW = 0, maxH = 0
      for (const { el } of targets) {
        if ((el.width ?? 0) > maxW) maxW = el.width ?? 0
        if ((el.height ?? 0) > maxH) maxH = el.height ?? 0
      }

      // Use the first element's position as the grid origin
      const originX = targets[0].el.x ?? 0
      const originY = targets[0].el.y ?? 0

      for (let i = 0; i < targets.length; i++) {
        const col = i % columns
        const row = Math.floor(i / columns)
        const { el, idx } = targets[i]
        elements[idx] = {
          ...el,
          x: originX + col * (maxW + gap),
          y: originY + row * (maxH + gap),
        }
      }
      break
    }

    default:
      return res.status(400).json({ error: `Unknown action: ${action}` })
  }

  const updated = db.update(canvases)
    .set({
      elements: JSON.stringify(elements),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(canvases.id, req.params.id))
    .returning().get()

  broadcastToCanvas(req.params.id, elements)

  res.json(updated)
})

// ---------------------------------------------------------------------------
// POST /canvases/:id/template — generate diagrams from structured data
// ---------------------------------------------------------------------------
agentRouter.post('/canvases/:id/template', (req, res) => {
  const canvas = db.select().from(canvases).where(eq(canvases.id, req.params.id)).get()
  if (!canvas) return res.status(404).json({ error: 'Canvas not found' })

  const { type, data } = req.body as { type: string; data: any }
  if (!type || !data) {
    return res.status(400).json({ error: 'type and data are required' })
  }

  const existingElements: any[] = JSON.parse(canvas.elements)
  let newElements: any[] = []

  switch (type) {
    case 'flowchart': {
      const { nodes, edges, direction } = data as {
        nodes: { id: string; label: string }[]
        edges: { from: string; to: string; label?: string }[]
        direction?: 'horizontal' | 'vertical'
      }

      if (!nodes || !Array.isArray(nodes)) {
        return res.status(400).json({ error: 'flowchart requires nodes array' })
      }

      const isHorizontal = direction !== 'vertical'
      const nodeWidth = 160
      const nodeHeight = 80
      const hSpacing = 250
      const vSpacing = 150

      const nodeMap = new Map<string, any>()

      // Create rectangle elements for nodes
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        const x = isHorizontal ? i * hSpacing : 0
        const y = isHorizontal ? 0 : i * vSpacing
        const elId = nanoid(8)

        // Color: first=#b2f2bb, last=#ffc9c9, others=#a5d8ff
        let bgColor = '#a5d8ff'
        if (i === 0) bgColor = '#b2f2bb'
        else if (i === nodes.length - 1) bgColor = '#ffc9c9'

        const rect = {
          id: elId,
          type: 'rectangle',
          x,
          y,
          width: nodeWidth,
          height: nodeHeight,
          backgroundColor: bgColor,
          fillStyle: 'solid',
          strokeColor: '#1e1e1e',
          strokeWidth: 2,
          roundness: { type: 3 },
          isDeleted: false,
          boundElements: [],
          seed: Math.floor(Math.random() * 2000000000),
          version: 1,
          versionNonce: Math.floor(Math.random() * 2000000000),
        }

        const label = {
          id: nanoid(8),
          type: 'text',
          x: x + nodeWidth / 2 - node.label.length * 4,
          y: y + nodeHeight / 2 - 10,
          width: node.label.length * 8,
          height: 20,
          text: node.label,
          fontSize: 16,
          fontFamily: 1,
          textAlign: 'center',
          verticalAlign: 'middle',
          containerId: elId,
          originalText: node.label,
          isDeleted: false,
          strokeColor: '#1e1e1e',
          seed: Math.floor(Math.random() * 2000000000),
          version: 1,
          versionNonce: Math.floor(Math.random() * 2000000000),
        }

        nodeMap.set(node.id, { rect, label, x, y })
        newElements.push(rect, label)
      }

      // Create arrows for edges
      if (edges && Array.isArray(edges)) {
        for (const edge of edges) {
          const fromNode = nodeMap.get(edge.from)
          const toNode = nodeMap.get(edge.to)
          if (!fromNode || !toNode) continue

          const startX = isHorizontal
            ? fromNode.x + nodeWidth
            : fromNode.x + nodeWidth / 2
          const startY = isHorizontal
            ? fromNode.y + nodeHeight / 2
            : fromNode.y + nodeHeight
          const endX = isHorizontal
            ? toNode.x
            : toNode.x + nodeWidth / 2
          const endY = isHorizontal
            ? toNode.y + nodeHeight / 2
            : toNode.y

          const arrowId = nanoid(8)
          const arrow: any = {
            id: arrowId,
            type: 'arrow',
            x: startX,
            y: startY,
            width: endX - startX,
            height: endY - startY,
            points: [[0, 0], [endX - startX, endY - startY]],
            strokeColor: '#1e1e1e',
            strokeWidth: 2,
            startBinding: { elementId: fromNode.rect.id, focus: 0, gap: 1 },
            endBinding: { elementId: toNode.rect.id, focus: 0, gap: 1 },
            isDeleted: false,
            seed: Math.floor(Math.random() * 2000000000),
            version: 1,
            versionNonce: Math.floor(Math.random() * 2000000000),
          }

          if (edge.label) {
            const labelEl = {
              id: nanoid(8),
              type: 'text',
              x: startX + (endX - startX) / 2 - edge.label.length * 4,
              y: startY + (endY - startY) / 2 - 10,
              width: edge.label.length * 8,
              height: 20,
              text: edge.label,
              fontSize: 14,
              fontFamily: 1,
              textAlign: 'center',
              verticalAlign: 'middle',
              containerId: arrowId,
              originalText: edge.label,
              isDeleted: false,
              strokeColor: '#1e1e1e',
              seed: Math.floor(Math.random() * 2000000000),
              version: 1,
              versionNonce: Math.floor(Math.random() * 2000000000),
            }
            newElements.push(labelEl)
          }

          newElements.push(arrow)
        }
      }
      break
    }

    case 'sequence': {
      const { actors, messages } = data as {
        actors: string[]
        messages: { from: string; to: string; label?: string }[]
      }

      if (!actors || !Array.isArray(actors)) {
        return res.status(400).json({ error: 'sequence requires actors array' })
      }

      const actorSpacing = 200
      const messageSpacing = 60
      const actorBoxWidth = 120
      const actorBoxHeight = 40
      const startY = 0
      const messagesStartY = startY + actorBoxHeight + 40

      const actorPositions = new Map<string, number>()

      // Create actor boxes
      for (let i = 0; i < actors.length; i++) {
        const x = i * actorSpacing
        actorPositions.set(actors[i], x + actorBoxWidth / 2)

        // Actor box
        const boxId = nanoid(8)
        newElements.push({
          id: boxId,
          type: 'rectangle',
          x,
          y: startY,
          width: actorBoxWidth,
          height: actorBoxHeight,
          backgroundColor: '#a5d8ff',
          fillStyle: 'solid',
          strokeColor: '#1e1e1e',
          strokeWidth: 2,
          isDeleted: false,
          seed: Math.floor(Math.random() * 2000000000),
          version: 1,
          versionNonce: Math.floor(Math.random() * 2000000000),
        })

        // Actor label
        newElements.push({
          id: nanoid(8),
          type: 'text',
          x: x + actorBoxWidth / 2 - actors[i].length * 4,
          y: startY + actorBoxHeight / 2 - 10,
          width: actors[i].length * 8,
          height: 20,
          text: actors[i],
          fontSize: 16,
          fontFamily: 1,
          textAlign: 'center',
          verticalAlign: 'middle',
          containerId: boxId,
          originalText: actors[i],
          isDeleted: false,
          strokeColor: '#1e1e1e',
          seed: Math.floor(Math.random() * 2000000000),
          version: 1,
          versionNonce: Math.floor(Math.random() * 2000000000),
        })

        // Dashed vertical lifeline
        const lineHeight = (messages?.length ?? 3) * messageSpacing + 60
        newElements.push({
          id: nanoid(8),
          type: 'line',
          x: x + actorBoxWidth / 2,
          y: startY + actorBoxHeight,
          width: 0,
          height: lineHeight,
          points: [[0, 0], [0, lineHeight]],
          strokeColor: '#868e96',
          strokeWidth: 1,
          strokeStyle: 'dashed',
          isDeleted: false,
          seed: Math.floor(Math.random() * 2000000000),
          version: 1,
          versionNonce: Math.floor(Math.random() * 2000000000),
        })
      }

      // Create message arrows
      if (messages && Array.isArray(messages)) {
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i]
          const fromX = actorPositions.get(msg.from) ?? 0
          const toX = actorPositions.get(msg.to) ?? 0
          const y = messagesStartY + i * messageSpacing

          const arrowId = nanoid(8)
          newElements.push({
            id: arrowId,
            type: 'arrow',
            x: fromX,
            y,
            width: toX - fromX,
            height: 0,
            points: [[0, 0], [toX - fromX, 0]],
            strokeColor: '#1e1e1e',
            strokeWidth: 2,
            isDeleted: false,
            seed: Math.floor(Math.random() * 2000000000),
            version: 1,
            versionNonce: Math.floor(Math.random() * 2000000000),
          })

          if (msg.label) {
            newElements.push({
              id: nanoid(8),
              type: 'text',
              x: Math.min(fromX, toX) + Math.abs(toX - fromX) / 2 - msg.label.length * 4,
              y: y - 20,
              width: msg.label.length * 8,
              height: 20,
              text: msg.label,
              fontSize: 14,
              fontFamily: 1,
              textAlign: 'center',
              isDeleted: false,
              strokeColor: '#1e1e1e',
              seed: Math.floor(Math.random() * 2000000000),
              version: 1,
              versionNonce: Math.floor(Math.random() * 2000000000),
            })
          }
        }
      }
      break
    }

    case 'mindmap': {
      const { root, children } = data as {
        root: string
        children?: { label: string; children?: { label: string }[] }[]
      }

      if (!root) {
        return res.status(400).json({ error: 'mindmap requires root' })
      }

      const centerX = 400
      const centerY = 300
      const radiusX = 250
      const radiusY = 200

      // Root node (ellipse)
      const rootId = nanoid(8)
      const rootWidth = Math.max(root.length * 10, 100)
      const rootHeight = 50
      newElements.push({
        id: rootId,
        type: 'ellipse',
        x: centerX - rootWidth / 2,
        y: centerY - rootHeight / 2,
        width: rootWidth,
        height: rootHeight,
        backgroundColor: '#b2f2bb',
        fillStyle: 'solid',
        strokeColor: '#1e1e1e',
        strokeWidth: 2,
        isDeleted: false,
        seed: Math.floor(Math.random() * 2000000000),
        version: 1,
        versionNonce: Math.floor(Math.random() * 2000000000),
      })

      // Root label
      newElements.push({
        id: nanoid(8),
        type: 'text',
        x: centerX - root.length * 4,
        y: centerY - 10,
        width: root.length * 8,
        height: 20,
        text: root,
        fontSize: 18,
        fontFamily: 1,
        textAlign: 'center',
        verticalAlign: 'middle',
        containerId: rootId,
        originalText: root,
        isDeleted: false,
        strokeColor: '#1e1e1e',
        seed: Math.floor(Math.random() * 2000000000),
        version: 1,
        versionNonce: Math.floor(Math.random() * 2000000000),
      })

      if (children && Array.isArray(children) && children.length > 0) {
        const childCount = children.length
        for (let i = 0; i < childCount; i++) {
          const angle = (2 * Math.PI * i) / childCount - Math.PI / 2
          const childX = centerX + Math.cos(angle) * radiusX
          const childY = centerY + Math.sin(angle) * radiusY
          const child = children[i]

          const childNodeWidth = Math.max(child.label.length * 10, 80)
          const childNodeHeight = 40
          const childId = nanoid(8)

          // Child ellipse
          newElements.push({
            id: childId,
            type: 'ellipse',
            x: childX - childNodeWidth / 2,
            y: childY - childNodeHeight / 2,
            width: childNodeWidth,
            height: childNodeHeight,
            backgroundColor: '#a5d8ff',
            fillStyle: 'solid',
            strokeColor: '#1e1e1e',
            strokeWidth: 2,
            isDeleted: false,
            seed: Math.floor(Math.random() * 2000000000),
            version: 1,
            versionNonce: Math.floor(Math.random() * 2000000000),
          })

          // Child label
          newElements.push({
            id: nanoid(8),
            type: 'text',
            x: childX - child.label.length * 4,
            y: childY - 10,
            width: child.label.length * 8,
            height: 20,
            text: child.label,
            fontSize: 16,
            fontFamily: 1,
            textAlign: 'center',
            verticalAlign: 'middle',
            containerId: childId,
            originalText: child.label,
            isDeleted: false,
            strokeColor: '#1e1e1e',
            seed: Math.floor(Math.random() * 2000000000),
            version: 1,
            versionNonce: Math.floor(Math.random() * 2000000000),
          })

          // Line from root to child
          newElements.push({
            id: nanoid(8),
            type: 'line',
            x: centerX,
            y: centerY,
            width: childX - centerX,
            height: childY - centerY,
            points: [[0, 0], [childX - centerX, childY - centerY]],
            strokeColor: '#1e1e1e',
            strokeWidth: 2,
            isDeleted: false,
            seed: Math.floor(Math.random() * 2000000000),
            version: 1,
            versionNonce: Math.floor(Math.random() * 2000000000),
          })

          // Grandchildren
          if (child.children && Array.isArray(child.children) && child.children.length > 0) {
            const gcRadius = 120
            const gcCount = child.children.length
            for (let j = 0; j < gcCount; j++) {
              // Spread grandchildren in a smaller arc around the child
              const gcAngle = angle - Math.PI / 4 + (Math.PI / 2) * (j / Math.max(gcCount - 1, 1))
              const gcX = childX + Math.cos(gcAngle) * gcRadius
              const gcY = childY + Math.sin(gcAngle) * gcRadius
              const gc = child.children[j]

              const gcNodeWidth = Math.max(gc.label.length * 10, 60)
              const gcNodeHeight = 30
              const gcId = nanoid(8)

              newElements.push({
                id: gcId,
                type: 'ellipse',
                x: gcX - gcNodeWidth / 2,
                y: gcY - gcNodeHeight / 2,
                width: gcNodeWidth,
                height: gcNodeHeight,
                backgroundColor: '#fff9db',
                fillStyle: 'solid',
                strokeColor: '#1e1e1e',
                strokeWidth: 1,
                isDeleted: false,
                seed: Math.floor(Math.random() * 2000000000),
                version: 1,
                versionNonce: Math.floor(Math.random() * 2000000000),
              })

              newElements.push({
                id: nanoid(8),
                type: 'text',
                x: gcX - gc.label.length * 3.5,
                y: gcY - 8,
                width: gc.label.length * 7,
                height: 16,
                text: gc.label,
                fontSize: 14,
                fontFamily: 1,
                textAlign: 'center',
                verticalAlign: 'middle',
                containerId: gcId,
                originalText: gc.label,
                isDeleted: false,
                strokeColor: '#1e1e1e',
                seed: Math.floor(Math.random() * 2000000000),
                version: 1,
                versionNonce: Math.floor(Math.random() * 2000000000),
              })

              // Line from child to grandchild
              newElements.push({
                id: nanoid(8),
                type: 'line',
                x: childX,
                y: childY,
                width: gcX - childX,
                height: gcY - childY,
                points: [[0, 0], [gcX - childX, gcY - childY]],
                strokeColor: '#868e96',
                strokeWidth: 1,
                isDeleted: false,
                seed: Math.floor(Math.random() * 2000000000),
                version: 1,
                versionNonce: Math.floor(Math.random() * 2000000000),
              })
            }
          }
        }
      }
      break
    }

    default:
      return res.status(400).json({ error: `Unknown template type: ${type}` })
  }

  // Append new elements to existing canvas
  const allElements = [...existingElements, ...newElements]

  const updated = db.update(canvases)
    .set({
      elements: JSON.stringify(allElements),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(canvases.id, req.params.id))
    .returning().get()

  broadcastToCanvas(req.params.id, allElements)

  res.json(updated)
})

// ---------------------------------------------------------------------------
// GET /canvases/:id/events — SSE event stream
// ---------------------------------------------------------------------------
agentRouter.get('/canvases/:id/events', (req, res) => {
  const canvas = db.select().from(canvases).where(eq(canvases.id, req.params.id)).get()
  if (!canvas) return res.status(404).json({ error: 'Canvas not found' })

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })
  res.flushHeaders()

  const unsubscribe = subscribeToCanvas(req.params.id, (event: any) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  })

  req.on('close', () => {
    unsubscribe()
  })
})

// ---------------------------------------------------------------------------
// POST /canvases/:id/snapshots — save a named snapshot
// ---------------------------------------------------------------------------
agentRouter.post('/canvases/:id/snapshots', (req, res) => {
  const canvas = db.select().from(canvases).where(eq(canvases.id, req.params.id)).get()
  if (!canvas) return res.status(404).json({ error: 'Canvas not found' })

  const { name } = req.body as { name?: string }

  const snapshot = db.insert(snapshots).values({
    id: nanoid(12),
    canvasId: req.params.id,
    name: name || `Snapshot ${new Date().toISOString()}`,
    elements: canvas.elements,
    appState: canvas.appState,
  }).returning().get()

  res.status(201).json(snapshot)
})

// ---------------------------------------------------------------------------
// GET /canvases/:id/snapshots — list snapshots
// ---------------------------------------------------------------------------
agentRouter.get('/canvases/:id/snapshots', (req, res) => {
  const allSnapshots = db.select({
    id: snapshots.id,
    name: snapshots.name,
    createdAt: snapshots.createdAt,
  })
    .from(snapshots)
    .where(eq(snapshots.canvasId, req.params.id))
    .all()

  res.json({ snapshots: allSnapshots })
})

// ---------------------------------------------------------------------------
// POST /canvases/:id/snapshots/:snapshotId/restore — restore a snapshot
// ---------------------------------------------------------------------------
agentRouter.post('/canvases/:id/snapshots/:snapshotId/restore', (req, res) => {
  const snapshot = db.select().from(snapshots)
    .where(eq(snapshots.id, req.params.snapshotId))
    .get()

  if (!snapshot || snapshot.canvasId !== req.params.id) {
    return res.status(404).json({ error: 'Snapshot not found' })
  }

  const elements = JSON.parse(snapshot.elements)

  const updated = db.update(canvases)
    .set({
      elements: snapshot.elements,
      appState: snapshot.appState,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(canvases.id, req.params.id))
    .returning().get()

  broadcastToCanvas(req.params.id, elements)

  res.json(updated)
})
