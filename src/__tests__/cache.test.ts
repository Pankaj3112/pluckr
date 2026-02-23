import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SelectorCache } from '../cache.js'
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

  it('stores and retrieves selectors', () => {
    const selectors = { title: 'h1', price: '.price' }
    cache.set('https://example.com', 'abc123', selectors)

    const result = cache.get('https://example.com', 'abc123')
    expect(result).toEqual(selectors)
  })

  it('updates selectors on duplicate key', () => {
    cache.set('https://example.com', 'abc123', { title: 'h1' })
    cache.set('https://example.com', 'abc123', { title: 'h2.new' })

    const result = cache.get('https://example.com', 'abc123')
    expect(result).toEqual({ title: 'h2.new' })
  })

  it('tracks consecutive failures', () => {
    cache.set('https://example.com', 'abc123', { title: 'h1' })

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
    cache.set('https://a.com', 'hash1', { title: 'h1' })
    cache.set('https://b.com', 'hash1', { title: 'h2' })
    cache.set('https://a.com', 'hash2', { title: 'h3' })

    expect(cache.get('https://a.com', 'hash1')).toEqual({ title: 'h1' })
    expect(cache.get('https://b.com', 'hash1')).toEqual({ title: 'h2' })
    expect(cache.get('https://a.com', 'hash2')).toEqual({ title: 'h3' })
  })
})
