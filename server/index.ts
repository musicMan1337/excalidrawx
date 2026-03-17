import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { setupWebSocket } from './ws.js'
import { canvasRouter } from './routes/canvas.js'
import { agentRouter } from './routes/agents.js'
import { initDb } from './db.js'

const app = express()
const server = createServer(app)

app.use(cors())
app.use(express.json({ limit: '50mb' }))
app.use('/api', canvasRouter)
app.use('/api', agentRouter)

setupWebSocket(server)
initDb()

const PORT = parseInt(process.env.PORT || '3001')
server.listen(PORT, () => {
  console.log(`ExcalidrawX server on http://localhost:${PORT}`)
  console.log(`  API:       http://localhost:${PORT}/api/canvases`)
  console.log(`  WebSocket: ws://localhost:${PORT}/ws?canvasId=<id>`)
})
