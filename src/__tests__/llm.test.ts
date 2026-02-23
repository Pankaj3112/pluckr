import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LanguageModel } from 'ai'
import { generateSelectors, fixSelectors } from '../llm.js'

// Mock the ai module
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    generateObject: vi.fn(),
  }
})

import { generateObject } from 'ai'

const mockGenerateObject = vi.mocked(generateObject)

const fakeModel = { modelId: 'test-model' } as LanguageModel

const html = '<html><body><h1>Product</h1><span class="price">$10</span></body></html>'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('generateSelectors', () => {
  it('calls generateObject and returns selectors', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: { title: 'h1', price: '.price' },
    } as any)

    const result = await generateSelectors(html, ['title', 'price'], fakeModel)
    expect(result).toEqual({ title: 'h1', price: '.price' })
    expect(mockGenerateObject).toHaveBeenCalledOnce()
  })
})

describe('fixSelectors', () => {
  it('calls generateObject with failure context and returns fixed selectors', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: { title: 'h1', price: 'span.price' },
    } as any)

    const result = await fixSelectors(
      html,
      { title: 'h1', price: '.wrong' },
      'price: Expected number, received NaN',
      { title: 'Product', price: null },
      fakeModel,
    )
    expect(result).toEqual({ title: 'h1', price: 'span.price' })
    expect(mockGenerateObject).toHaveBeenCalledOnce()
  })
})
