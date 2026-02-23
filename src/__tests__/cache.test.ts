import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SqliteStorage } from '../cache.js'
import type { FieldMappings } from '../types.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('SqliteStorage', () => {
  let storage: SqliteStorage
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healscrape-test-'))
    storage = new SqliteStorage(path.join(tmpDir, 'cache.db'))
  })

  afterEach(async () => {
    await storage.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns null for cache miss', async () => {
    const result = await storage.get('https://example.com', 'abc123')
    expect(result).toBeNull()
  })

  it('stores and retrieves cache entries', async () => {
    const mappings: FieldMappings = {
      title: { selector: 'h1', transform: 'value.trim()' },
      price: { selector: '.price', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
    }
    await storage.set('https://example.com', 'abc123', {
      fieldMappings: mappings,
      consecutiveFailures: 0,
    })

    const result = await storage.get('https://example.com', 'abc123')
    expect(result).toEqual({ fieldMappings: mappings, consecutiveFailures: 0 })
  })

  it('updates entry on duplicate key', async () => {
    const original: FieldMappings = { title: { selector: 'h1', transform: 'value.trim()' } }
    const updated: FieldMappings = { title: { selector: 'h2.new', transform: 'value.toUpperCase()' } }

    await storage.set('https://example.com', 'abc123', { fieldMappings: original, consecutiveFailures: 0 })
    await storage.set('https://example.com', 'abc123', { fieldMappings: updated, consecutiveFailures: 0 })

    const result = await storage.get('https://example.com', 'abc123')
    expect(result?.fieldMappings).toEqual(updated)
  })

  it('stores and retrieves consecutive failures', async () => {
    await storage.set('https://example.com', 'abc123', {
      fieldMappings: { title: { selector: 'h1', transform: 'value.trim()' } },
      consecutiveFailures: 0,
    })

    let result = await storage.get('https://example.com', 'abc123')
    expect(result?.consecutiveFailures).toBe(0)

    await storage.set('https://example.com', 'abc123', {
      fieldMappings: result!.fieldMappings,
      consecutiveFailures: 2,
    })
    result = await storage.get('https://example.com', 'abc123')
    expect(result?.consecutiveFailures).toBe(2)

    await storage.set('https://example.com', 'abc123', {
      fieldMappings: result!.fieldMappings,
      consecutiveFailures: 0,
    })
    result = await storage.get('https://example.com', 'abc123')
    expect(result?.consecutiveFailures).toBe(0)
  })

  it('isolates entries by key and schema hash', async () => {
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
})
