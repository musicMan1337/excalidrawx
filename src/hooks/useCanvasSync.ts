import { useEffect, useRef, useState, useCallback } from 'react'

interface ExcalidrawAPI {
  getSceneElements(): readonly any[]
  getAppState(): Record<string, any>
  getFiles(): Record<string, any>
  updateScene(scene: { elements?: readonly any[] }): void
  scrollToContent(target?: any, opts?: { fitToContent?: boolean; animate?: boolean }): void
}

type SaveStatus = 'saved' | 'saving' | 'unsaved'

interface UseCanvasSyncOptions {
  canvasId: string | null
  apiRef: React.MutableRefObject<ExcalidrawAPI | null>
  onSaveStatusChange?: (status: SaveStatus) => void
  onScreenshotRequest: (
    requestId: string,
    options?: { width?: number; height?: number; background?: boolean },
  ) => Promise<string | null>
}

export function useCanvasSync({ canvasId, apiRef, onSaveStatusChange, onScreenshotRequest }: UseCanvasSyncOptions) {
  const [initialElements, setInitialElements] = useState<any[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const isRemoteUpdate = useRef(false)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveConfirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initialized = useRef(false)
  const lastVersionSum = useRef(0)

  useEffect(() => {
    if (!canvasId) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?canvasId=${canvasId}`)
    wsRef.current = ws

    ws.onopen = () => {
      setIsConnected(true)
      console.log('[sync] connected')
    }

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)

      switch (msg.type) {
        case 'canvas:loaded': {
          const elements = JSON.parse(msg.canvas.elements)
          setInitialElements(elements)
          initialized.current = true

          const api = apiRef.current
          if (api && elements.length > 0) {
            isRemoteUpdate.current = true
            api.updateScene({ elements })
            isRemoteUpdate.current = false
            // Scroll viewport to show content after loading
            setTimeout(() => {
              try { api.scrollToContent() } catch {}
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
          onScreenshotRequest(msg.requestId, msg.options).then((dataUrl) => {
            if (dataUrl && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'screenshot:response',
                requestId: msg.requestId,
                dataUrl,
              }))
            }
          })
          break
        }
      }
    }

    ws.onclose = () => {
      setIsConnected(false)
      console.log('[sync] disconnected')
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [canvasId])

  const onElementsChange = useCallback((elements: readonly any[]) => {
    if (isRemoteUpdate.current || !initialized.current) return

    // Cheap change detection: sum of element versions + count
    const versionSum = elements.reduce((sum, el) => sum + (el.version || 0), 0) + elements.length
    if (versionSum === lastVersionSum.current) return
    lastVersionSum.current = versionSum

    onSaveStatusChange?.('unsaved')

    // Debounce to avoid flooding the server
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        onSaveStatusChange?.('saving')
        ws.send(JSON.stringify({
          type: 'elements:update',
          canvasId,
          elements,
        }))

        // Mark as saved after a short delay (server doesn't ack)
        if (saveConfirmTimer.current) clearTimeout(saveConfirmTimer.current)
        saveConfirmTimer.current = setTimeout(() => {
          onSaveStatusChange?.('saved')
        }, 500)
      }
    }, 300)
  }, [canvasId, onSaveStatusChange])

  return { initialElements, onElementsChange, isConnected }
}
