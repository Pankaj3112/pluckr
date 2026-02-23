import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { LanguageModel } from 'ai'
import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { FieldMappings } from '../types.js'

vi.mock('../fetcher.js', () => ({
  fetchAndClean: vi.fn(),
}))

vi.mock('../llm.js', () => ({
  extractWithTools: vi.fn(),
}))

import { fetchAndClean } from '../fetcher.js'
import { extractWithTools } from '../llm.js'
import { Scraper } from '../scraper.js'

const mockFetch = vi.mocked(fetchAndClean)
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
    mockFetch.mockResolvedValueOnce(PRODUCT_HTML)
    mockExtract.mockResolvedValueOnce({
      success: true,
      data: { title: 'Widget', price: 29.99, inStock: true },
      fieldMappings: goodMappings,
    })

    const result = await scraper.scrape({ url: 'https://example.com/product', schema })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ title: 'Widget', price: 29.99, inStock: true })
    }
  })

  it('uses cached field mappings on second call (no LLM)', async () => {
    mockFetch.mockResolvedValue(PRODUCT_HTML)
    mockExtract.mockResolvedValueOnce({
      success: true,
      data: { title: 'Widget', price: 29.99, inStock: true },
      fieldMappings: goodMappings,
    })

    await scraper.scrape({ url: 'https://example.com/product', schema })
    const result = await scraper.scrape({ url: 'https://example.com/product', schema })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ title: 'Widget', price: 29.99, inStock: true })
    }
    // extractWithTools should only be called once — second call uses cache
    expect(mockExtract).toHaveBeenCalledOnce()
  })

  it('returns NO_DATA error when AI reports no data', async () => {
    mockFetch.mockResolvedValueOnce(PRODUCT_HTML)
    mockExtract.mockResolvedValueOnce({
      success: false,
      error: { code: 'NO_DATA', message: 'Page is a login form' },
    })

    const result = await scraper.scrape({ url: 'https://example.com/product', schema })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('NO_DATA')
    }
  })

  it('returns EXTRACTION_FAILED when tool loop exhausts', async () => {
    mockFetch.mockResolvedValueOnce(PRODUCT_HTML)
    mockExtract.mockResolvedValueOnce({
      success: false,
      error: { code: 'EXTRACTION_FAILED', message: 'Could not extract' },
    })

    const result = await scraper.scrape({ url: 'https://example.com/product', schema })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('EXTRACTION_FAILED')
    }
  })

  it('returns PERMANENT_FAILURE after too many consecutive failures', async () => {
    mockFetch.mockResolvedValue(PRODUCT_HTML)
    mockExtract.mockResolvedValue({
      success: false,
      error: { code: 'EXTRACTION_FAILED', message: 'Failed' },
    })

    // Exhaust consecutive failure count
    for (let i = 0; i < 4; i++) {
      await scraper.scrape({ url: 'https://example.com/product', schema })
    }

    const result = await scraper.scrape({ url: 'https://example.com/product', schema })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('PERMANENT_FAILURE')
    }
    // Should NOT have called fetch or extract on the 5th attempt
    expect(mockFetch).toHaveBeenCalledTimes(4)
    expect(mockExtract).toHaveBeenCalledTimes(4)
  })

  it('returns FETCH_FAILED when page fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('net::ERR_CONNECTION_REFUSED'))

    const result = await scraper.scrape({ url: 'https://example.com/product', schema })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('FETCH_FAILED')
      expect(result.error.message).toContain('ERR_CONNECTION_REFUSED')
    }
  })

  it('re-runs tool loop with cached hint when cache hit fails validation', async () => {
    mockFetch.mockResolvedValue(PRODUCT_HTML)

    // First call: succeeds and caches
    mockExtract.mockResolvedValueOnce({
      success: true,
      data: { title: 'Widget', price: 29.99, inStock: true },
      fieldMappings: goodMappings,
    })
    await scraper.scrape({ url: 'https://example.com/product', schema })

    // Simulate page change — cached selectors fail, need tool loop with hint
    const changedHtml = '<html><body><h2>Widget v2</h2><div class="new-price">$39.99</div></body></html>'
    mockFetch.mockResolvedValueOnce(changedHtml)
    mockExtract.mockResolvedValueOnce({
      success: true,
      data: { title: 'Widget v2', price: 39.99, inStock: true },
      fieldMappings: {
        title: { selector: 'h2', transform: 'value.trim()' },
        price: { selector: '.new-price', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
        inStock: { selector: '#stock', transform: "value.toLowerCase().includes('in stock')" },
      },
    })

    const result = await scraper.scrape({ url: 'https://example.com/product', schema })

    // extractWithTools should have been called with cachedMappings
    expect(mockExtract).toHaveBeenCalledTimes(2)
    const secondCallArgs = mockExtract.mock.calls[1][0] as any
    expect(secondCallArgs.cachedMappings).toBeDefined()
  })

  it('passes maxToolCalls from config', async () => {
    const customScraper = new Scraper({
      model: fakeModel,
      cachePath: path.join(tmpDir, 'cache2.db'),
      maxToolCalls: 7,
    })

    mockFetch.mockResolvedValueOnce(PRODUCT_HTML)
    mockExtract.mockResolvedValueOnce({
      success: true,
      data: { title: 'Widget', price: 29.99, inStock: true },
      fieldMappings: goodMappings,
    })

    await customScraper.scrape({ url: 'https://example.com/product', schema })

    const callArgs = mockExtract.mock.calls[0][0] as any
    expect(callArgs.maxToolCalls).toBe(7)

    customScraper.close()
  })
})
