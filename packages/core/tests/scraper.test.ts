import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { LanguageModel } from 'ai'
import { z } from 'zod'
import type { CacheEntry, FieldMappings, Storage } from '../src/types.js'

vi.mock('../src/llm.js', () => ({
  extractWithTools: vi.fn(),
}))

import { extractWithTools } from '../src/llm.js'
import { Pluckr } from '../src/scraper.js'

const mockExtract = vi.mocked(extractWithTools)

const fakeModel = { modelId: 'test-model' } as LanguageModel

const PRODUCT_HTML = `<html><body>
  <h1>Widget</h1>
  <span class="price">$29.99</span>
  <span id="stock">In Stock</span>
</body></html>`

const schema = z.object({
  title: z.string(),
  price: z.number().positive(),
  inStock: z.boolean(),
})

const goodMappings: FieldMappings = {
  title: { selector: 'h1', transform: 'value.trim()' },
  price: { selector: '.price', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
  inStock: { selector: '#stock', transform: "value.toLowerCase().includes('in stock')" },
}

function createMemoryStorage(): Storage {
  const entries = new Map<string, CacheEntry>()
  return {
    get: async (key, schemaHash) => entries.get(`${key}:${schemaHash}`) ?? null,
    set: async (key, schemaHash, entry) => { entries.set(`${key}:${schemaHash}`, entry) },
    close: async () => {},
  }
}

describe('Pluckr', () => {
  let pluckr: Pluckr

  beforeEach(() => {
    vi.clearAllMocks()
    pluckr = new Pluckr({
      model: fakeModel,
      storage: createMemoryStorage(),
    })
  })

  afterEach(async () => {
    await pluckr.close()
  })

  it('returns success result when extraction succeeds', async () => {
    mockExtract.mockResolvedValueOnce({
      success: true,
      data: { title: 'Widget', price: 29.99, inStock: true },
      fieldMappings: goodMappings,
    })

    const result = await pluckr.extract({ html: PRODUCT_HTML, schema, cacheKey: 'test-product' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ title: 'Widget', price: 29.99, inStock: true })
    }
  })

  it('uses cached field mappings on second call (no LLM)', async () => {
    mockExtract.mockResolvedValueOnce({
      success: true,
      data: { title: 'Widget', price: 29.99, inStock: true },
      fieldMappings: goodMappings,
    })

    await pluckr.extract({ html: PRODUCT_HTML, schema, cacheKey: 'test-product' })
    const result = await pluckr.extract({ html: PRODUCT_HTML, schema, cacheKey: 'test-product' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ title: 'Widget', price: 29.99, inStock: true })
    }
    expect(mockExtract).toHaveBeenCalledOnce()
  })

  it('skips caching entirely when no cacheKey provided', async () => {
    mockExtract.mockResolvedValue({
      success: true,
      data: { title: 'Widget', price: 29.99, inStock: true },
      fieldMappings: goodMappings,
    })

    await pluckr.extract({ html: PRODUCT_HTML, schema })
    await pluckr.extract({ html: PRODUCT_HTML, schema })

    expect(mockExtract).toHaveBeenCalledTimes(2)
  })

  it('uses default in-memory cache when no storage provided', async () => {
    const defaultPluckr = new Pluckr({ model: fakeModel })

    mockExtract.mockResolvedValueOnce({
      success: true,
      data: { title: 'Widget', price: 29.99, inStock: true },
      fieldMappings: goodMappings,
    })

    await defaultPluckr.extract({ html: PRODUCT_HTML, schema, cacheKey: 'test' })
    const result = await defaultPluckr.extract({ html: PRODUCT_HTML, schema, cacheKey: 'test' })

    // Default MemoryStorage caches — second call uses cache, no LLM
    expect(mockExtract).toHaveBeenCalledOnce()
    expect(result.success).toBe(true)

    await defaultPluckr.close()
  })

  it('returns NO_DATA error when AI reports no data', async () => {
    mockExtract.mockResolvedValueOnce({
      success: false,
      error: { code: 'NO_DATA', message: 'Page is a login form' },
    })

    const result = await pluckr.extract({ html: PRODUCT_HTML, schema, cacheKey: 'test-product' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('NO_DATA')
    }
  })

  it('returns EXTRACTION_FAILED when tool loop exhausts', async () => {
    mockExtract.mockResolvedValueOnce({
      success: false,
      error: { code: 'EXTRACTION_FAILED', message: 'Could not extract' },
    })

    const result = await pluckr.extract({ html: PRODUCT_HTML, schema, cacheKey: 'test-product' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('EXTRACTION_FAILED')
    }
  })

  it('returns PERMANENT_FAILURE after too many consecutive failures', async () => {
    mockExtract.mockResolvedValue({
      success: false,
      error: { code: 'EXTRACTION_FAILED', message: 'Failed' },
    })

    for (let i = 0; i < 4; i++) {
      await pluckr.extract({ html: PRODUCT_HTML, schema, cacheKey: 'test-product' })
    }

    const result = await pluckr.extract({ html: PRODUCT_HTML, schema, cacheKey: 'test-product' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('PERMANENT_FAILURE')
    }
    expect(mockExtract).toHaveBeenCalledTimes(4)
  })

  it('does not track permanent failures when no cacheKey', async () => {
    mockExtract.mockResolvedValue({
      success: false,
      error: { code: 'EXTRACTION_FAILED', message: 'Failed' },
    })

    for (let i = 0; i < 5; i++) {
      const result = await pluckr.extract({ html: PRODUCT_HTML, schema })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('EXTRACTION_FAILED')
      }
    }

    expect(mockExtract).toHaveBeenCalledTimes(5)
  })

  it('re-runs tool loop with cached hint when cache hit fails validation', async () => {
    mockExtract.mockResolvedValueOnce({
      success: true,
      data: { title: 'Widget', price: 29.99, inStock: true },
      fieldMappings: goodMappings,
    })
    await pluckr.extract({ html: PRODUCT_HTML, schema, cacheKey: 'test-product' })

    const changedHtml = '<html><body><h2>Widget v2</h2><div class="new-price">$39.99</div></body></html>'
    mockExtract.mockResolvedValueOnce({
      success: true,
      data: { title: 'Widget v2', price: 39.99, inStock: true },
      fieldMappings: {
        title: { selector: 'h2', transform: 'value.trim()' },
        price: { selector: '.new-price', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
        inStock: { selector: '#stock', transform: "value.toLowerCase().includes('in stock')" },
      },
    })

    const result = await pluckr.extract({ html: changedHtml, schema, cacheKey: 'test-product' })

    expect(mockExtract).toHaveBeenCalledTimes(2)
    const secondCallArgs = mockExtract.mock.calls[1][0] as any
    expect(secondCallArgs.cachedMappings).toBeDefined()
  })

  it('passes maxToolCallsPerField * fieldCount as maxToolCalls', async () => {
    const customPluckr = new Pluckr({
      model: fakeModel,
      storage: createMemoryStorage(),
      maxToolCallsPerField: 5,
    })

    mockExtract.mockResolvedValueOnce({
      success: true,
      data: { title: 'Widget', price: 29.99, inStock: true },
      fieldMappings: goodMappings,
    })

    await customPluckr.extract({ html: PRODUCT_HTML, schema, cacheKey: 'test-product' })

    const callArgs = mockExtract.mock.calls[0][0] as any
    expect(callArgs.maxToolCalls).toBe(15)

    await customPluckr.close()
  })
})
