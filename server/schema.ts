import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const canvases = sqliteTable('canvases', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default('Untitled'),
  elements: text('elements').notNull().default('[]'),
  appState: text('app_state').notNull().default('{}'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
})

export const snapshots = sqliteTable('snapshots', {
  id: text('id').primaryKey(),
  canvasId: text('canvas_id').notNull(),
  name: text('name').notNull().default('Snapshot'),
  elements: text('elements').notNull().default('[]'),
  appState: text('app_state').notNull().default('{}'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
})
