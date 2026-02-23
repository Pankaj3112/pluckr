import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CacheEntry, FieldMappings } from '@pluckr/core'

const store = new Map<string, string>()
const mockSet = vi.fn(async (key: string, value: string, ..._rest: unknown[]) => {
  store.set(key, value)
  return 'OK'
})
const mockGet = vi.fn(async (key: string) => store.get(key) ?? null)
const mockQuit = vi.fn(async () => 'OK')

vi.mock('ioredis', () => {
  const MockRedis = vi.fn(() => ({
    set: mockSet,
    get: mockGet,
    quit: mockQuit,
    on: vi.fn(),
  }))
  return { default: MockRedis, Redis: MockRedis }
})

import { RedisStorage } from '../src/index.js'

describe('RedisStorage', () => {
  beforeEach(() => {
    store.clear()
    mockSet.mockClear()
    mockGet.mockClear()
    mockQuit.mockClear()
  })

  it('returns null for cache miss', async () => {
    const storage = new RedisStorage()
    const result = await storage.get('https://example.com', 'abc123')
    expect(result).toBeNull()
  })

  it('stores and retrieves cache entries', async () => {
    const storage = new RedisStorage()
    const mappings: FieldMappings = {
      title: { selector: 'h1', transform: 'value.trim()' },
      price: { selector: '.price', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
    }
    const entry: CacheEntry = { fieldMappings: mappings, consecutiveFailures: 0 }

    await storage.set('https://example.com', 'abc123', entry)
    const result = await storage.get('https://example.com', 'abc123')
    expect(result).toEqual(entry)
  })

  it('updates entry on duplicate key', async () => {
    const storage = new RedisStorage()
    const original: FieldMappings = { title: { selector: 'h1', transform: 'value.trim()' } }
    const updated: FieldMappings = { title: { selector: 'h2.new', transform: 'value.toUpperCase()' } }

    await storage.set('https://example.com', 'abc123', { fieldMappings: original, consecutiveFailures: 0 })
    await storage.set('https://example.com', 'abc123', { fieldMappings: updated, consecutiveFailures: 0 })

    const result = await storage.get('https://example.com', 'abc123')
    expect(result?.fieldMappings).toEqual(updated)
  })

  it('stores and retrieves consecutive failures', async () => {
    const storage = new RedisStorage()
    const mappings: FieldMappings = { title: { selector: 'h1', transform: 'value.trim()' } }

    await storage.set('https://example.com', 'abc123', { fieldMappings: mappings, consecutiveFailures: 0 })
    let result = await storage.get('https://example.com', 'abc123')
    expect(result?.consecutiveFailures).toBe(0)

    await storage.set('https://example.com', 'abc123', { fieldMappings: mappings, consecutiveFailures: 2 })
    result = await storage.get('https://example.com', 'abc123')
    expect(result?.consecutiveFailures).toBe(2)
  })

  it('isolates entries by key and schema hash', async () => {
    const storage = new RedisStorage()
    const a: FieldMappings = { title: { selector: 'h1', transform: 'value.trim()' } }
    const b: FieldMappings = { title: { selector: 'h2', transform: 'value.trim()' } }
    const c: FieldMappings = { title: { selector: 'h3', transform: 'value.trim()' } }

    await storage.set('https://a.com', 'hash1', { fieldMappings: a, consecutiveFailures: 0 })
    await storage.set('https://b.com', 'hash1', { fieldMappings: b, consecutiveFailures: 0 })
    await storage.set('https://a.com', 'hash2', { fieldMappings: c, consecutiveFailures: 0 })

    expect((await storage.get('https://a.com', 'hash1'))?.fieldMappings).toEqual(a)
    expect((await storage.get('https://b.com', 'hash1'))?.fieldMappings).toEqual(b)
    expect((await storage.get('https://a.com', 'hash2'))?.fieldMappings).toEqual(c)
  })

  it('uses custom key prefix', async () => {
    const storage = new RedisStorage({ prefix: 'custom:' })
    const mappings: FieldMappings = { title: { selector: 'h1', transform: 'value.trim()' } }

    await storage.set('mykey', 'hash1', { fieldMappings: mappings, consecutiveFailures: 0 })
    expect(mockSet).toHaveBeenCalledWith(
      'custom:mykey:hash1',
      expect.any(String),
    )
  })

  it('uses default prefix pluckr:', async () => {
    const storage = new RedisStorage()
    const mappings: FieldMappings = { title: { selector: 'h1', transform: 'value.trim()' } }

    await storage.set('mykey', 'hash1', { fieldMappings: mappings, consecutiveFailures: 0 })
    expect(mockSet).toHaveBeenCalledWith(
      'pluckr:mykey:hash1',
      expect.any(String),
    )
  })

  it('passes TTL to redis.set when configured', async () => {
    const storage = new RedisStorage({ ttl: 3600 })
    const mappings: FieldMappings = { title: { selector: 'h1', transform: 'value.trim()' } }

    await storage.set('mykey', 'hash1', { fieldMappings: mappings, consecutiveFailures: 0 })
    expect(mockSet).toHaveBeenCalledWith(
      'pluckr:mykey:hash1',
      expect.any(String),
      'EX',
      3600,
    )
  })

  it('does not pass TTL when not configured', async () => {
    const storage = new RedisStorage()
    const mappings: FieldMappings = { title: { selector: 'h1', transform: 'value.trim()' } }

    await storage.set('mykey', 'hash1', { fieldMappings: mappings, consecutiveFailures: 0 })
    expect(mockSet).toHaveBeenCalledWith(
      'pluckr:mykey:hash1',
      expect.any(String),
    )
  })

  it('close() calls quit on owned connection', async () => {
    const storage = new RedisStorage({ url: 'redis://localhost:6379' })
    await storage.close()
    expect(mockQuit).toHaveBeenCalled()
  })

  it('close() is a no-op for BYO redis instance', async () => {
    const fakeRedis = { set: mockSet, get: mockGet, quit: mockQuit } as any
    const storage = new RedisStorage({ redis: fakeRedis })
    await storage.close()
    expect(mockQuit).not.toHaveBeenCalled()
  })

  it('returns null when stored value is not valid JSON', async () => {
    const storage = new RedisStorage()
    store.set('pluckr:corrupt:hash1', 'not-json')
    const result = await storage.get('corrupt', 'hash1')
    expect(result).toBeNull()
  })
})
