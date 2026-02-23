import Redis from 'ioredis'
import type { CacheEntry, Storage } from '@pluckr/core'

export interface RedisStorageOptions {
  /** Existing ioredis instance. If provided, close() is a no-op. */
  redis?: Redis
  /** Redis URL (e.g. redis://localhost:6379). Creates a new connection. */
  url?: string
  /** Key prefix. Default: "pluckr:" */
  prefix?: string
  /** TTL in seconds. Default: no expiry. */
  ttl?: number
}

export class RedisStorage implements Storage {
  private redis: Redis
  private owned: boolean
  private prefix: string
  private ttl?: number

  constructor(options?: RedisStorageOptions) {
    this.prefix = options?.prefix ?? 'pluckr:'
    this.ttl = options?.ttl

    if (options?.redis) {
      this.redis = options.redis
      this.owned = false
    } else {
      this.redis = options?.url ? new Redis(options.url) : new Redis()
      this.owned = true
      this.redis.on('error', () => {})
    }
  }

  private key(key: string, schemaHash: string): string {
    return `${this.prefix}${key}:${schemaHash}`
  }

  async get(key: string, schemaHash: string): Promise<CacheEntry | null> {
    const raw = await this.redis.get(this.key(key, schemaHash))
    if (!raw) return null
    try {
      return JSON.parse(raw) as CacheEntry
    } catch {
      return null
    }
  }

  async set(key: string, schemaHash: string, entry: CacheEntry): Promise<void> {
    const redisKey = this.key(key, schemaHash)
    const value = JSON.stringify(entry)

    if (this.ttl !== undefined) {
      await this.redis.set(redisKey, value, 'EX', this.ttl)
    } else {
      await this.redis.set(redisKey, value)
    }
  }

  async close(): Promise<void> {
    if (this.owned) {
      await this.redis.quit()
    }
  }
}
