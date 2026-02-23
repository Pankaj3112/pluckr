import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateSelectors, fixSelectors, type LLMConfig } from '../llm.js'

// Mock the ai module
vi.mock('ai', () => ({
  generateObject: vi.fn(),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn((model: string) => ({ modelId: model, provider: 'anthropic' }))),
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => vi.fn((model: string) => ({ modelId: model, provider: 'openai' }))),
}))

import { generateObject } from 'ai'

const mockGenerateObject = vi.mocked(generateObject)

const config: LLMConfig = {
  provider: 'anthropic',
  apiKey: 'test-key',
  model: 'claude-haiku-4-5-20251001',
}

const html = '<html><body><h1>Product</h1><span class="price">$10</span></body></html>'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('generateSelectors', () => {
  it('calls generateObject and returns selectors', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        selectors: { title: 'h1', price: '.price' },
      },
    } as any)

    const result = await generateSelectors(html, ['title', 'price'], config)
    expect(result).toEqual({ title: 'h1', price: '.price' })
    expect(mockGenerateObject).toHaveBeenCalledOnce()
  })
})

describe('fixSelectors', () => {
  it('calls generateObject with failure context and returns fixed selectors', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        selectors: { title: 'h1', price: 'span.price' },
      },
    } as any)

    const result = await fixSelectors(
      html,
      { title: 'h1', price: '.wrong' },
      'price: Expected number, received NaN',
      { title: 'Product', price: null },
      config,
    )
    expect(result).toEqual({ title: 'h1', price: 'span.price' })
    expect(mockGenerateObject).toHaveBeenCalledOnce()
  })
})
