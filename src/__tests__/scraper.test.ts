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
  generateFieldMappings: vi.fn(),
  fixFieldMappings: vi.fn(),
}))

import { fetchAndClean } from '../fetcher.js'
import { generateFieldMappings, fixFieldMappings } from '../llm.js'
import { Scraper } from '../scraper.js'
import { ExtractionFailed, PermanentFailure } from '../exceptions.js'

const mockFetch = vi.mocked(fetchAndClean)
const mockGenerate = vi.mocked(generateFieldMappings)
const mockFix = vi.mocked(fixFieldMappings)

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

  it('generates field mappings, extracts and transforms data, returns typed result', async () => {
    mockFetch.mockResolvedValueOnce(PRODUCT_HTML)
    mockGenerate.mockResolvedValueOnce(goodMappings)

    const result = await scraper.scrape({ url: 'https://example.com/product', schema })

    expect(result).toEqual({ title: 'Widget', price: 29.99, inStock: true })
    expect(mockGenerate).toHaveBeenCalledOnce()
  })

  it('uses cached field mappings on second call (no LLM)', async () => {
    mockFetch.mockResolvedValue(PRODUCT_HTML)
    mockGenerate.mockResolvedValueOnce(goodMappings)

    await scraper.scrape({ url: 'https://example.com/product', schema })
    const result = await scraper.scrape({ url: 'https://example.com/product', schema })

    expect(result).toEqual({ title: 'Widget', price: 29.99, inStock: true })
    expect(mockGenerate).toHaveBeenCalledOnce() // NOT called again
  })

  it('heals field mappings when validation fails then retry works', async () => {
    mockFetch.mockResolvedValueOnce(PRODUCT_HTML)
    const badMappings: FieldMappings = {
      title: { selector: 'h1', transform: 'value.trim()' },
      price: { selector: '.nonexistent', transform: 'parseFloat(value)' },
      inStock: { selector: '#stock', transform: "value.toLowerCase().includes('in stock')" },
    }
    mockGenerate.mockResolvedValueOnce(badMappings)
    mockFix.mockResolvedValueOnce(goodMappings)

    const result = await scraper.scrape({ url: 'https://example.com/product', schema })

    expect(result).toEqual({ title: 'Widget', price: 29.99, inStock: true })
    expect(mockFix).toHaveBeenCalledOnce()
  })

  it('throws ExtractionFailed when healing also fails', async () => {
    mockFetch.mockResolvedValueOnce(PRODUCT_HTML)
    const badMappings: FieldMappings = {
      title: { selector: 'h1', transform: 'value.trim()' },
      price: { selector: '.nonexistent', transform: 'parseFloat(value)' },
      inStock: { selector: '#stock', transform: "value.toLowerCase().includes('in stock')" },
    }
    mockGenerate.mockResolvedValueOnce(badMappings)
    mockFix.mockResolvedValueOnce({
      title: { selector: 'h1', transform: 'value.trim()' },
      price: { selector: '.still-nonexistent', transform: 'parseFloat(value)' },
      inStock: { selector: '#stock', transform: "value.toLowerCase().includes('in stock')" },
    })

    await expect(
      scraper.scrape({ url: 'https://example.com/product', schema }),
    ).rejects.toThrow(ExtractionFailed)
  })

  it('throws PermanentFailure after 4+ consecutive failures', async () => {
    mockFetch.mockResolvedValue(PRODUCT_HTML)
    const badMappings: FieldMappings = {
      title: { selector: 'h1', transform: 'value.trim()' },
      price: { selector: '.nonexistent', transform: 'parseFloat(value)' },
      inStock: { selector: '#stock', transform: "value.toLowerCase().includes('in stock')" },
    }
    mockGenerate.mockResolvedValue(badMappings)
    mockFix.mockResolvedValue({
      title: { selector: 'h1', transform: 'value.trim()' },
      price: { selector: '.still-nonexistent', transform: 'parseFloat(value)' },
      inStock: { selector: '#stock', transform: "value.toLowerCase().includes('in stock')" },
    })

    for (let i = 0; i < 4; i++) {
      await scraper.scrape({ url: 'https://example.com/product', schema }).catch(() => {})
    }

    await expect(
      scraper.scrape({ url: 'https://example.com/product', schema }),
    ).rejects.toThrow(PermanentFailure)
  })

  it('invalidates cache when schema description changes', async () => {
    mockFetch.mockResolvedValue(PRODUCT_HTML)
    mockGenerate.mockResolvedValue(goodMappings)

    const schema1 = z.object({
      title: z.string(),
      price: z.number().describe('strip dollar sign'),
      inStock: z.boolean(),
    })
    const schema2 = z.object({
      title: z.string(),
      price: z.number().describe('remove currency symbol'),
      inStock: z.boolean(),
    })

    await scraper.scrape({ url: 'https://example.com/product', schema: schema1 })
    await scraper.scrape({ url: 'https://example.com/product', schema: schema2 })

    // Should have called generate twice — different descriptions = different hash
    expect(mockGenerate).toHaveBeenCalledTimes(2)
  })
})
