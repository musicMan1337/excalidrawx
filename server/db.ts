import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

const sqlite = new Database('excalidraw.db')
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

export const db = drizzle(sqlite, { schema })

export function initDb() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS canvases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'Untitled',
      elements TEXT NOT NULL DEFAULT '[]',
      app_state TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      canvas_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'Snapshot',
      elements TEXT NOT NULL DEFAULT '[]',
      app_state TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE
    )
  `)
  console.log('Database initialized')
}
