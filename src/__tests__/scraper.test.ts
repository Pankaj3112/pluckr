import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { LanguageModel } from 'ai'
import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// Mock dependencies
vi.mock('../fetcher.js', () => ({
  fetchAndClean: vi.fn(),
}))

vi.mock('../llm.js', () => ({
  generateSelectors: vi.fn(),
  fixSelectors: vi.fn(),
}))

import { fetchAndClean } from '../fetcher.js'
import { generateSelectors, fixSelectors } from '../llm.js'
import { Scraper } from '../scraper.js'
import { ExtractionFailed, PermanentFailure } from '../exceptions.js'

const mockFetch = vi.mocked(fetchAndClean)
const mockGenerate = vi.mocked(generateSelectors)
const mockFix = vi.mocked(fixSelectors)

const fakeModel = { modelId: 'test-model' } as LanguageModel

const PRODUCT_HTML = `<html><body>
  <h1>Widget</h1>
  <span class="price">29.99</span>
  <span id="stock">true</span>
</body></html>`

const schema = z.object({
  title: z.string(),
  price: z.coerce.number().positive(),
  inStock: z.coerce.boolean(),
})

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

  it('generates selectors, extracts data, caches, and returns typed result', async () => {
    mockFetch.mockResolvedValueOnce(PRODUCT_HTML)
    mockGenerate.mockResolvedValueOnce({
      title: 'h1',
      price: '.price',
      inStock: '#stock',
    })

    const result = await scraper.scrape({ url: 'https://example.com/product', schema })

    expect(result).toEqual({ title: 'Widget', price: 29.99, inStock: true })
    expect(mockGenerate).toHaveBeenCalledOnce()
  })

  it('uses cached selectors on second call (no LLM)', async () => {
    mockFetch.mockResolvedValue(PRODUCT_HTML)
    mockGenerate.mockResolvedValueOnce({
      title: 'h1',
      price: '.price',
      inStock: '#stock',
    })

    await scraper.scrape({ url: 'https://example.com/product', schema })
    const result = await scraper.scrape({ url: 'https://example.com/product', schema })

    expect(result).toEqual({ title: 'Widget', price: 29.99, inStock: true })
    expect(mockGenerate).toHaveBeenCalledOnce() // NOT called again
  })

  it('heals selectors when validation fails then retried selectors work', async () => {
    mockFetch.mockResolvedValueOnce(PRODUCT_HTML)
    // First attempt: bad price selector
    mockGenerate.mockResolvedValueOnce({
      title: 'h1',
      price: '.nonexistent',
      inStock: '#stock',
    })
    // Fix: correct price selector
    mockFix.mockResolvedValueOnce({
      title: 'h1',
      price: '.price',
      inStock: '#stock',
    })

    const result = await scraper.scrape({ url: 'https://example.com/product', schema })

    expect(result).toEqual({ title: 'Widget', price: 29.99, inStock: true })
    expect(mockFix).toHaveBeenCalledOnce()
  })

  it('throws ExtractionFailed when healing also fails', async () => {
    mockFetch.mockResolvedValueOnce(PRODUCT_HTML)
    mockGenerate.mockResolvedValueOnce({
      title: 'h1',
      price: '.nonexistent',
      inStock: '#stock',
    })
    mockFix.mockResolvedValueOnce({
      title: 'h1',
      price: '.still-nonexistent',
      inStock: '#stock',
    })

    await expect(
      scraper.scrape({ url: 'https://example.com/product', schema }),
    ).rejects.toThrow(ExtractionFailed)
  })

  it('throws PermanentFailure after 4+ consecutive failures', async () => {
    mockFetch.mockResolvedValue(PRODUCT_HTML)
    mockGenerate.mockResolvedValue({
      title: 'h1',
      price: '.nonexistent',
      inStock: '#stock',
    })
    mockFix.mockResolvedValue({
      title: 'h1',
      price: '.still-nonexistent',
      inStock: '#stock',
    })

    // Fail 4 times
    for (let i = 0; i < 4; i++) {
      await scraper.scrape({ url: 'https://example.com/product', schema }).catch(() => {})
    }

    // 5th attempt should throw PermanentFailure immediately
    await expect(
      scraper.scrape({ url: 'https://example.com/product', schema }),
    ).rejects.toThrow(PermanentFailure)
  })
})
