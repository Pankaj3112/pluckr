import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SelectorCache } from '../cache.js'
import type { FieldMappings } from '../types.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('SelectorCache', () => {
  let cache: SelectorCache
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healscrape-test-'))
    cache = new SelectorCache(path.join(tmpDir, 'cache.db'))
  })

  afterEach(() => {
    cache.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns null for cache miss', () => {
    const result = cache.get('https://example.com', 'abc123')
    expect(result).toBeNull()
  })

  it('stores and retrieves field mappings', () => {
    const mappings: FieldMappings = {
      title: { selector: 'h1', transform: 'value.trim()' },
      price: { selector: '.price', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
    }
    cache.set('https://example.com', 'abc123', mappings)

    const result = cache.get('https://example.com', 'abc123')
    expect(result).toEqual(mappings)
  })

  it('updates field mappings on duplicate key', () => {
    const original: FieldMappings = { title: { selector: 'h1', transform: 'value.trim()' } }
    const updated: FieldMappings = { title: { selector: 'h2.new', transform: 'value.toUpperCase()' } }

    cache.set('https://example.com', 'abc123', original)
    cache.set('https://example.com', 'abc123', updated)

    const result = cache.get('https://example.com', 'abc123')
    expect(result).toEqual(updated)
  })

  it('tracks consecutive failures', () => {
    cache.set('https://example.com', 'abc123', {
      title: { selector: 'h1', transform: 'value.trim()' },
    })

    expect(cache.getFailureCount('https://example.com', 'abc123')).toBe(0)

    cache.incrementFailures('https://example.com', 'abc123')
    cache.incrementFailures('https://example.com', 'abc123')
    expect(cache.getFailureCount('https://example.com', 'abc123')).toBe(2)

    cache.resetFailures('https://example.com', 'abc123')
    expect(cache.getFailureCount('https://example.com', 'abc123')).toBe(0)
  })

  it('returns 0 failures for unknown entries', () => {
    expect(cache.getFailureCount('https://unknown.com', 'xyz')).toBe(0)
  })

  it('isolates entries by url and schema hash', () => {
    const a: FieldMappings = { title: { selector: 'h1', transform: 'value.trim()' } }
    const b: FieldMappings = { title: { selector: 'h2', transform: 'value.trim()' } }
    const c: FieldMappings = { title: { selector: 'h3', transform: 'value.trim()' } }

    cache.set('https://a.com', 'hash1', a)
    cache.set('https://b.com', 'hash1', b)
    cache.set('https://a.com', 'hash2', c)

    expect(cache.get('https://a.com', 'hash1')).toEqual(a)
    expect(cache.get('https://b.com', 'hash1')).toEqual(b)
    expect(cache.get('https://a.com', 'hash2')).toEqual(c)
  })
})
