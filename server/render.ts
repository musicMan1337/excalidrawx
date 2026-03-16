/**
 * Server-side SVG renderer for Excalidraw elements.
 * Generates SVG from element JSON without requiring a browser/DOM.
 * Used as fallback when no browser client is connected for screenshots.
 */

interface Element {
  type: string
  x: number
  y: number
  width: number
  height: number
  strokeColor?: string
  backgroundColor?: string
  fillStyle?: string
  strokeWidth?: number
  opacity?: number
  angle?: number
  roughness?: number
  roundness?: { type: number } | null
  points?: [number, number][]
  text?: string
  fontSize?: number
  fontFamily?: number
  textAlign?: string
  isDeleted?: boolean
  endArrowhead?: string | null
  startArrowhead?: string | null
  strokeStyle?: string
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function computeBounds(elements: Element[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

  for (const el of elements) {
    if (el.isDeleted) continue

    if (el.points && el.points.length > 0) {
      for (const [px, py] of el.points) {
        minX = Math.min(minX, el.x + px)
        minY = Math.min(minY, el.y + py)
        maxX = Math.max(maxX, el.x + px)
        maxY = Math.max(maxY, el.y + py)
      }
    } else {
      minX = Math.min(minX, el.x)
      minY = Math.min(minY, el.y)
      maxX = Math.max(maxX, el.x + (el.width || 0))
      maxY = Math.max(maxY, el.y + (el.height || 0))
    }
  }

  if (!isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 100, maxY: 100 }
  }

  return { minX, minY, maxX, maxY }
}

function renderElement(el: Element): string {
  if (el.isDeleted) return ''

  const stroke = el.strokeColor || '#1e1e1e'
  const fill = (el.backgroundColor && el.backgroundColor !== 'transparent')
    ? el.backgroundColor
    : 'none'
  const sw = el.strokeWidth ?? 2
  const opacity = (el.opacity ?? 100) / 100
  const angle = el.angle || 0
  const cx = el.x + (el.width || 0) / 2
  const cy = el.y + (el.height || 0) / 2
  const transform = angle ? ` transform="rotate(${(angle * 180) / Math.PI} ${cx} ${cy})"` : ''
  const dashArray = el.strokeStyle === 'dashed' ? ' stroke-dasharray="8 4"' : el.strokeStyle === 'dotted' ? ' stroke-dasharray="2 4"' : ''

  switch (el.type) {
    case 'rectangle': {
      const rx = el.roundness ? Math.min(el.width, el.height) * 0.1 : 0
      return `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="${opacity}"${dashArray}${transform}/>`
    }

    case 'ellipse':
      return `<ellipse cx="${cx}" cy="${cy}" rx="${el.width / 2}" ry="${el.height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="${opacity}"${dashArray}${transform}/>`

    case 'diamond': {
      const mx = el.x + el.width / 2
      const my = el.y + el.height / 2
      const pts = `${mx},${el.y} ${el.x + el.width},${my} ${mx},${el.y + el.height} ${el.x},${my}`
      return `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" opacity="${opacity}"${dashArray}${transform}/>`
    }

    case 'text': {
      const fontSize = el.fontSize || 20
      const fontFamily = el.fontFamily === 2 ? 'Cascadia, monospace' : el.fontFamily === 3 ? 'Comic Sans MS, cursive' : 'Virgil, sans-serif'
      const anchor = el.textAlign === 'center' ? 'middle' : el.textAlign === 'right' ? 'end' : 'start'
      const lines = (el.text || '').split('\n')
      const textEls = lines.map((line, i) =>
        `<tspan x="${el.x}" dy="${i === 0 ? 0 : fontSize * 1.2}">${escapeXml(line)}</tspan>`
      ).join('')
      return `<text x="${el.x}" y="${el.y + fontSize}" font-size="${fontSize}" font-family="${fontFamily}" fill="${stroke}" text-anchor="${anchor}" opacity="${opacity}"${transform}>${textEls}</text>`
    }

    case 'arrow':
    case 'line': {
      if (!el.points || el.points.length < 2) return ''
      const pathData = el.points.map((p, i) =>
        `${i === 0 ? 'M' : 'L'} ${el.x + p[0]} ${el.y + p[1]}`
      ).join(' ')
      const markerEnd = (el.type === 'arrow' && el.endArrowhead !== null) ? ' marker-end="url(#arrowhead)"' : ''
      return `<path d="${pathData}" fill="none" stroke="${stroke}" stroke-width="${sw}" opacity="${opacity}"${dashArray}${markerEnd}/>`
    }

    case 'freedraw': {
      if (!el.points || el.points.length < 2) return ''
      const pathData = el.points.map((p, i) =>
        `${i === 0 ? 'M' : 'L'} ${el.x + p[0]} ${el.y + p[1]}`
      ).join(' ')
      return `<path d="${pathData}" fill="none" stroke="${stroke}" stroke-width="${sw}" opacity="${opacity}" stroke-linecap="round" stroke-linejoin="round"/>`
    }

    default:
      return ''
  }
}

export function renderElementsToSvg(elementsJson: string, options?: { width?: number; height?: number; background?: string }): string {
  const elements: Element[] = JSON.parse(elementsJson).filter((el: Element) => !el.isDeleted)

  if (elements.length === 0) {
    const w = options?.width || 400
    const h = options?.height || 300
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="${options?.background || '#ffffff'}"/>
  <text x="${w / 2}" y="${h / 2}" text-anchor="middle" fill="#999" font-size="16" font-family="sans-serif">Empty canvas</text>
</svg>`
  }

  const padding = 40
  const bounds = computeBounds(elements)
  const contentW = bounds.maxX - bounds.minX + padding * 2
  const contentH = bounds.maxY - bounds.minY + padding * 2
  const vbX = bounds.minX - padding
  const vbY = bounds.minY - padding

  const w = options?.width || Math.max(contentW, 200)
  const h = options?.height || Math.max(contentH, 200)
  const bg = options?.background || '#ffffff'

  const svgElements = elements.map(renderElement).filter(Boolean).join('\n  ')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vbX} ${vbY} ${contentW} ${contentH}">
  <defs>
    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto" fill="#1e1e1e">
      <polygon points="0 0, 10 3.5, 0 7"/>
    </marker>
  </defs>
  <rect x="${vbX}" y="${vbY}" width="${contentW}" height="${contentH}" fill="${bg}"/>
  ${svgElements}
</svg>`
}
