import type { CacheEntry, Storage } from './types.js'

export class MemoryStorage implements Storage {
  private entries = new Map<string, CacheEntry>()

  async get(key: string, schemaHash: string): Promise<CacheEntry | null> {
    return this.entries.get(`${key}:${schemaHash}`) ?? null
  }

  async set(key: string, schemaHash: string, entry: CacheEntry): Promise<void> {
    this.entries.set(`${key}:${schemaHash}`, entry)
  }

  async close(): Promise<void> {
    this.entries.clear()
  }
}
