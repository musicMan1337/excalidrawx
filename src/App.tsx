import { useState, useEffect, useRef } from 'react'
import { Excalidraw, MainMenu, WelcomeScreen, exportToBlob } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import { useCanvasSync } from './hooks/useCanvasSync'

interface ExcalidrawAPI {
  getSceneElements(): readonly any[]
  getAppState(): Record<string, any>
  getFiles(): Record<string, any>
  updateScene(scene: { elements?: readonly any[] }): void
  scrollToContent(): void
}

export default function App() {
  const [canvasId, setCanvasId] = useState<string | null>(null)
  const [canvasList, setCanvasList] = useState<any[]>([])
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const apiRef = useRef<ExcalidrawAPI | null>(null)

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('canvas')
    if (id) setCanvasId(id)
    else fetchCanvasList()
  }, [])

  const fetchCanvasList = async () => {
    const res = await fetch('/api/canvases')
    const data = await res.json()
    setCanvasList(data.canvases)
  }

  const createCanvas = async () => {
    const res = await fetch('/api/canvases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Canvas' }),
    })
    const canvas = await res.json()
    window.location.search = `?canvas=${canvas.id}`
  }

  const { initialElements, onElementsChange, isConnected } = useCanvasSync({
    canvasId,
    apiRef,
    onSaveStatusChange: setSaveStatus,
    onScreenshotRequest: async (_requestId, options) => {
      const api = apiRef.current
      if (!api) return null

      const elements = api.getSceneElements()
      const appState = api.getAppState()
      const files = api.getFiles()

      const blob = await exportToBlob({
        elements: elements as any,
        appState: {
          ...appState,
          exportWithDarkMode: false,
          exportBackground: options?.background ?? true,
        },
        files,
        getDimensions: () => ({
          width: options?.width || 1200,
          height: options?.height || 800,
          scale: 1,
        }),
      })

      return new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.readAsDataURL(blob)
      })
    },
  })

  // Canvas list page
  if (!canvasId) {
    return (
      <div style={{ padding: 40, fontFamily: 'system-ui' }}>
        <h1>ExcalidrawX</h1>
        <p style={{ color: '#666', marginBottom: 20 }}>Agent-first collaborative drawing</p>
        <button
          onClick={createCanvas}
          style={{
            padding: '10px 20px',
            fontSize: 16,
            cursor: 'pointer',
            marginBottom: 20,
            borderRadius: 6,
            border: '1px solid #ccc',
          }}
        >
          + New Canvas
        </button>
        <div>
          {canvasList.map((c) => (
            <a
              key={c.id}
              href={`?canvas=${c.id}`}
              style={{
                display: 'block',
                padding: 12,
                border: '1px solid #eee',
                marginBottom: 8,
                borderRadius: 8,
                textDecoration: 'none',
                color: '#333',
              }}
            >
              <strong>{c.name}</strong>
              <span style={{ color: '#999', marginLeft: 12, fontSize: 13 }}>{c.id}</span>
            </a>
          ))}
          {canvasList.length === 0 && (
            <p style={{ color: '#999' }}>No canvases yet. Create one or use the API.</p>
          )}
        </div>
      </div>
    )
  }

  const saveStatusColor = saveStatus === 'saved' ? '#22c55e' : saveStatus === 'saving' ? '#f59e0b' : '#999'
  const saveStatusText = saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving...' : 'Unsaved'

  // Canvas editor
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Excalidraw
        excalidrawAPI={(api: any) => { apiRef.current = api }}
        initialData={{ elements: initialElements }}
        onChange={(elements: any) => onElementsChange(elements)}
        renderTopRightUI={() => (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            fontFamily: 'system-ui',
            fontSize: 13,
          }}>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              color: saveStatusColor,
            }}>
              <span style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                backgroundColor: isConnected ? saveStatusColor : '#ef4444',
                display: 'inline-block',
              }} />
              {isConnected ? saveStatusText : 'Offline'}
            </span>
          </div>
        )}
      >
        <MainMenu>
          <MainMenu.DefaultItems.LoadScene />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.Export />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.DefaultItems.ToggleTheme />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.Help />
        </MainMenu>

        <WelcomeScreen>
          <WelcomeScreen.Hints.ToolbarHint />
          <WelcomeScreen.Hints.MenuHint />
          <WelcomeScreen.Hints.HelpHint />
          <WelcomeScreen.Center>
            <WelcomeScreen.Center.Heading>
              ExcalidrawX
            </WelcomeScreen.Center.Heading>
            <WelcomeScreen.Center.Menu>
              <WelcomeScreen.Center.MenuItemLoadScene />
              <WelcomeScreen.Center.MenuItemHelp />
            </WelcomeScreen.Center.Menu>
          </WelcomeScreen.Center>
        </WelcomeScreen>
      </Excalidraw>
    </div>
  )
}
