import { useEffect, useRef, useState, useCallback } from 'react'

type SaveStatus = 'saved' | 'saving' | 'unsaved'

interface ScreenshotOptions {
  width?: number
  height?: number
  background?: boolean
}

interface WsCanvasLoaded {
  type: 'canvas:loaded'
  canvas: { elements: string }
}

interface WsElementsUpdate {
  type: 'elements:update'
  elements: readonly Record<string, unknown>[]
}

interface WsScreenshotRequest {
  type: 'screenshot:request'
  requestId: string
  options?: ScreenshotOptions
}

type WsMessage = WsCanvasLoaded | WsElementsUpdate | WsScreenshotRequest

export interface ExcalidrawAPI {
  getSceneElements(): readonly Record<string, unknown>[]
  getAppState(): Record<string, unknown>
  getFiles(): Record<string, unknown>
  updateScene(scene: { elements?: readonly Record<string, unknown>[] }): void
  scrollToContent(): void
}

interface UseCanvasSyncOptions {
  canvasId: string | null
  apiRef: React.MutableRefObject<ExcalidrawAPI | null>
  onSaveStatusChange?: (status: SaveStatus) => void
  onScreenshotRequest: (requestId: string, options?: ScreenshotOptions) => Promise<string | null>
}

interface VersionedElement {
  version?: number
}

export function useCanvasSync({ canvasId, apiRef, onSaveStatusChange, onScreenshotRequest }: UseCanvasSyncOptions) {
  const [initialElements, setInitialElements] = useState<Record<string, unknown>[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const isRemoteUpdate = useRef(false)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveConfirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initialized = useRef(false)
  const lastVersionSum = useRef(0)

  useEffect(() => {
    if (!canvasId) return undefined

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?canvasId=${canvasId}`)
    wsRef.current = ws

    ws.onopen = () => {
      setIsConnected(true)
    }

    ws.onmessage = (event: MessageEvent) => {
      const msg = JSON.parse(event.data as string) as WsMessage

      switch (msg.type) {
        case 'canvas:loaded': {
          const elements = JSON.parse(msg.canvas.elements) as Record<string, unknown>[]
          setInitialElements(elements)
          initialized.current = true

          const api = apiRef.current
          if (api && elements.length > 0) {
            isRemoteUpdate.current = true
            api.updateScene({ elements })
            isRemoteUpdate.current = false
            setTimeout(() => {
              try {
                api.scrollToContent()
              } catch {
                // scrollToContent may fail if canvas is empty
              }
            }, 200)
          }
          onSaveStatusChange?.('saved')
          break
        }

        case 'elements:update': {
          const api = apiRef.current
          if (api) {
            isRemoteUpdate.current = true
            api.updateScene({ elements: msg.elements })
            isRemoteUpdate.current = false
          }
          break
        }

        case 'screenshot:request': {
          void onScreenshotRequest(msg.requestId, msg.options).then((dataUrl) => {
            if (dataUrl && ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: 'screenshot:response',
                  requestId: msg.requestId,
                  dataUrl,
                }),
              )
            }
          })
          break
        }
      }
    }

    ws.onclose = () => {
      setIsConnected(false)
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [canvasId, apiRef, onSaveStatusChange, onScreenshotRequest])

  const onElementsChange = useCallback(
    (elements: readonly VersionedElement[]) => {
      if (isRemoteUpdate.current || !initialized.current) return

      // Cheap change detection: sum of element versions + count
      const versionSum = elements.reduce((sum, el) => sum + (el.version ?? 0), 0) + elements.length
      if (versionSum === lastVersionSum.current) return
      lastVersionSum.current = versionSum

      onSaveStatusChange?.('unsaved')

      // Debounce to avoid flooding the server
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      debounceTimer.current = setTimeout(() => {
        const ws = wsRef.current
        if (ws?.readyState === WebSocket.OPEN) {
          onSaveStatusChange?.('saving')
          ws.send(
            JSON.stringify({
              type: 'elements:update',
              canvasId,
              elements,
            }),
          )

          // Mark as saved after a short delay (server doesn't ack)
          if (saveConfirmTimer.current) clearTimeout(saveConfirmTimer.current)
          saveConfirmTimer.current = setTimeout(() => {
            onSaveStatusChange?.('saved')
          }, 500)
        }
      }, 300)
    },
    [canvasId, onSaveStatusChange],
  )

  return { initialElements, onElementsChange, isConnected }
}
