import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

export class SelectorCache {
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

  get(url: string, schemaHash: string): Record<string, string> | null {
    const row = this.db
      .prepare('SELECT selectors FROM selector_cache WHERE url = ? AND schema_hash = ?')
      .get(url, schemaHash) as { selectors: string } | undefined

    return row ? JSON.parse(row.selectors) : null
  }

  set(url: string, schemaHash: string, selectors: Record<string, string>): void {
    this.db
      .prepare(
        `INSERT INTO selector_cache (url, schema_hash, selectors, last_success_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(url, schema_hash)
         DO UPDATE SET selectors = excluded.selectors,
                       last_success_at = excluded.last_success_at,
                       consecutive_failures = 0`
      )
      .run(url, schemaHash, JSON.stringify(selectors))
  }

  getFailureCount(url: string, schemaHash: string): number {
    const row = this.db
      .prepare('SELECT consecutive_failures FROM selector_cache WHERE url = ? AND schema_hash = ?')
      .get(url, schemaHash) as { consecutive_failures: number } | undefined

    return row?.consecutive_failures ?? 0
  }

  incrementFailures(url: string, schemaHash: string): void {
    this.db
      .prepare(
        `UPDATE selector_cache
         SET consecutive_failures = consecutive_failures + 1
         WHERE url = ? AND schema_hash = ?`
      )
      .run(url, schemaHash)
  }

  resetFailures(url: string, schemaHash: string): void {
    this.db
      .prepare(
        `UPDATE selector_cache
         SET consecutive_failures = 0, last_success_at = datetime('now')
         WHERE url = ? AND schema_hash = ?`
      )
      .run(url, schemaHash)
  }

  close(): void {
    this.db.close()
  }
}
