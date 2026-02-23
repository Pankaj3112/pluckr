import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { LanguageModel } from 'ai'
import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { FieldMappings } from '../types.js'

vi.mock('../llm.js', () => ({
  extractWithTools: vi.fn(),
}))

import { extractWithTools } from '../llm.js'
import { Scraper } from '../scraper.js'

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

describe('Scraper', () => {
  let scraper: Scraper
  let tmpDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healscrape-test-'))
    scraper = new Scraper({
      model: fakeModel,
      cachePath: path.join(tmpDir, 'cache.db'),
    })
  })

  afterEach(() => {
    scraper.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns success result when extraction succeeds', async () => {
    mockExtract.mockResolvedValueOnce({
      success: true,
      data: { title: 'Widget', price: 29.99, inStock: true },
      fieldMappings: goodMappings,
    })

    const result = await scraper.scrape({ html: PRODUCT_HTML, schema, cacheKey: 'test-product' })

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

    await scraper.scrape({ html: PRODUCT_HTML, schema, cacheKey: 'test-product' })
    const result = await scraper.scrape({ html: PRODUCT_HTML, schema, cacheKey: 'test-product' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ title: 'Widget', price: 29.99, inStock: true })
    }
    // extractWithTools should only be called once — second call uses cache
    expect(mockExtract).toHaveBeenCalledOnce()
  })

  it('skips caching entirely when no cacheKey provided', async () => {
    mockExtract.mockResolvedValue({
      success: true,
      data: { title: 'Widget', price: 29.99, inStock: true },
      fieldMappings: goodMappings,
    })

    await scraper.scrape({ html: PRODUCT_HTML, schema })
    await scraper.scrape({ html: PRODUCT_HTML, schema })

    // Without cacheKey, extractWithTools is called every time (no cache)
    expect(mockExtract).toHaveBeenCalledTimes(2)
  })

  it('returns NO_DATA error when AI reports no data', async () => {
    mockExtract.mockResolvedValueOnce({
      success: false,
      error: { code: 'NO_DATA', message: 'Page is a login form' },
    })

    const result = await scraper.scrape({ html: PRODUCT_HTML, schema, cacheKey: 'test-product' })

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

    const result = await scraper.scrape({ html: PRODUCT_HTML, schema, cacheKey: 'test-product' })

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

    // Exhaust consecutive failure count
    for (let i = 0; i < 4; i++) {
      await scraper.scrape({ html: PRODUCT_HTML, schema, cacheKey: 'test-product' })
    }

    const result = await scraper.scrape({ html: PRODUCT_HTML, schema, cacheKey: 'test-product' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('PERMANENT_FAILURE')
    }
    // Should NOT have called extract on the 5th attempt
    expect(mockExtract).toHaveBeenCalledTimes(4)
  })

  it('does not track permanent failures when no cacheKey', async () => {
    mockExtract.mockResolvedValue({
      success: false,
      error: { code: 'EXTRACTION_FAILED', message: 'Failed' },
    })

    // Without cacheKey, failures aren't tracked, so no PERMANENT_FAILURE
    for (let i = 0; i < 5; i++) {
      const result = await scraper.scrape({ html: PRODUCT_HTML, schema })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('EXTRACTION_FAILED')
      }
    }

    // All 5 calls went through to extractWithTools (no permanent failure short-circuit)
    expect(mockExtract).toHaveBeenCalledTimes(5)
  })

  it('re-runs tool loop with cached hint when cache hit fails validation', async () => {
    // First call: succeeds and caches
    mockExtract.mockResolvedValueOnce({
      success: true,
      data: { title: 'Widget', price: 29.99, inStock: true },
      fieldMappings: goodMappings,
    })
    await scraper.scrape({ html: PRODUCT_HTML, schema, cacheKey: 'test-product' })

    // Simulate page change — cached selectors fail, need tool loop with hint
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

    const result = await scraper.scrape({ html: changedHtml, schema, cacheKey: 'test-product' })

    // extractWithTools should have been called with cachedMappings
    expect(mockExtract).toHaveBeenCalledTimes(2)
    const secondCallArgs = mockExtract.mock.calls[1][0] as any
    expect(secondCallArgs.cachedMappings).toBeDefined()
  })

  it('passes maxToolCallsPerField * fieldCount as maxToolCalls', async () => {
    const customScraper = new Scraper({
      model: fakeModel,
      cachePath: path.join(tmpDir, 'cache2.db'),
      maxToolCallsPerField: 5,
    })

    mockExtract.mockResolvedValueOnce({
      success: true,
      data: { title: 'Widget', price: 29.99, inStock: true },
      fieldMappings: goodMappings,
    })

    await customScraper.scrape({ html: PRODUCT_HTML, schema, cacheKey: 'test-product' })

    const callArgs = mockExtract.mock.calls[0][0] as any
    // schema has 3 fields (title, price, inStock), so 5 * 3 = 15
    expect(callArgs.maxToolCalls).toBe(15)

    customScraper.close()
  })
})
