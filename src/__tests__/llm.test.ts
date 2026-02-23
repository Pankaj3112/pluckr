import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LanguageModel } from 'ai'
import type { FieldInfo } from '../prompts.js'
import { generateFieldMappings, fixFieldMappings } from '../llm.js'

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

describe('generateFieldMappings', () => {
  it('calls generateObject and returns field mappings with selectors and transforms', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        title: { selector: 'h1', transform: 'value.trim()' },
        price: { selector: '.price', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
      },
    } as any)

    const fields: FieldInfo[] = [
      { name: 'title', type: 'ZodString' },
      { name: 'price', type: 'ZodNumber', description: 'strip currency symbol' },
    ]

    const result = await generateFieldMappings(html, fields, fakeModel)

    expect(result).toEqual({
      title: { selector: 'h1', transform: 'value.trim()' },
      price: { selector: '.price', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
    })
    expect(mockGenerateObject).toHaveBeenCalledOnce()
  })
})

describe('fixFieldMappings', () => {
  it('calls generateObject with failure context and returns fixed field mappings', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        title: { selector: 'h1', transform: 'value.trim()' },
        price: { selector: 'span.price', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
      },
    } as any)

    const result = await fixFieldMappings(
      html,
      {
        title: { selector: 'h1', transform: 'value.trim()' },
        price: { selector: '.wrong', transform: "parseFloat(value)" },
      },
      'price: Expected number, received NaN',
      { title: 'Product', price: null },
      fakeModel,
    )

    expect(result).toEqual({
      title: { selector: 'h1', transform: 'value.trim()' },
      price: { selector: 'span.price', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
    })
    expect(mockGenerateObject).toHaveBeenCalledOnce()
  })
})
