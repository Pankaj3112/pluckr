import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import type { CacheEntry, Storage } from './types.js'

export class SqliteStorage implements Storage {
  private db: Database.Database

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? path.join(process.cwd(), '.healscrape', 'cache.db')
    const dir = path.dirname(resolvedPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    this.db = new Database(resolvedPath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS selector_cache (
        id INTEGER PRIMARY KEY,
        url TEXT NOT NULL,
        schema_hash TEXT NOT NULL,
        selectors TEXT NOT NULL,
        consecutive_failures INTEGER DEFAULT 0,
        last_success_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(url, schema_hash)
      )
    `)
  }

  async get(key: string, schemaHash: string): Promise<CacheEntry | null> {
    const row = this.db
      .prepare('SELECT selectors, consecutive_failures FROM selector_cache WHERE url = ? AND schema_hash = ?')
      .get(key, schemaHash) as { selectors: string; consecutive_failures: number } | undefined

    if (!row) return null
    return {
      fieldMappings: JSON.parse(row.selectors),
      consecutiveFailures: row.consecutive_failures,
    }
  }

  async set(key: string, schemaHash: string, entry: CacheEntry): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO selector_cache (url, schema_hash, selectors, consecutive_failures, last_success_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(url, schema_hash)
         DO UPDATE SET selectors = excluded.selectors,
                       consecutive_failures = excluded.consecutive_failures,
                       last_success_at = excluded.last_success_at`
      )
      .run(key, schemaHash, JSON.stringify(entry.fieldMappings), entry.consecutiveFailures)
  }

  async close(): Promise<void> {
    this.db.close()
  }
}
