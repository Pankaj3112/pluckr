import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LanguageModel } from 'ai'
import type { FieldInfo } from '../src/prompts.js'
import { extractWithTools, type ExtractionResult } from '../src/llm.js'
import { z } from 'zod'

// Mock the 'ai' module
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    generateText: vi.fn(),
  }
})

import { generateText } from 'ai'

const mockGenerateText = vi.mocked(generateText)
const fakeModel = { modelId: 'test-model' } as LanguageModel

const html = '<html><body><h1>Product</h1><span class="price">$10</span></body></html>'
const schema = z.object({
  title: z.string(),
  price: z.number(),
})
const fields: FieldInfo[] = [
  { name: 'title', type: 'ZodString' },
  { name: 'price', type: 'ZodNumber' },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('extractWithTools', () => {
  it('returns success when AI submits valid mappings', async () => {
    // Simulate: AI calls submitResult with good mappings
    mockGenerateText.mockResolvedValueOnce({
      text: '',
      steps: [
        {
          toolCalls: [{
            toolName: 'submitResult',
            args: {
              mappings: {
                title: { selector: 'h1', transform: 'value.trim()' },
                price: { selector: '.price', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
              },
            },
          }],
          toolResults: [{
            toolName: 'submitResult',
            result: { valid: true, data: { title: 'Product', price: 10 } },
          }],
        },
      ],
    } as any)

    const result = await extractWithTools({
      html,
      fields,
      schema,
      model: fakeModel,
      maxToolCalls: 3,
    })

    expect(result).toEqual({
      success: true,
      data: { title: 'Product', price: 10 },
      fieldMappings: {
        title: { selector: 'h1', transform: 'value.trim()' },
        price: { selector: '.price', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
      },
    })
  })

  it('returns no-data error when AI calls reportNoData', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: '',
      steps: [
        {
          toolCalls: [{
            toolName: 'reportNoData',
            args: { reason: 'Page is a login form, no product data' },
          }],
          toolResults: [{
            toolName: 'reportNoData',
            result: { reported: true },
          }],
        },
      ],
    } as any)

    const result = await extractWithTools({
      html,
      fields,
      schema,
      model: fakeModel,
      maxToolCalls: 3,
    })

    expect(result).toEqual({
      success: false,
      error: {
        code: 'NO_DATA',
        message: 'Page is a login form, no product data',
      },
    })
  })

  it('returns extraction-failed when tool loop exhausts without valid submit', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'I could not find the right selectors.',
      steps: [
        {
          toolCalls: [{
            toolName: 'testSelector',
            args: { selector: '.wrong', transform: 'value.trim()' },
          }],
          toolResults: [{
            toolName: 'testSelector',
            result: { found: false, error: 'No element matched selector: .wrong' },
          }],
        },
      ],
    } as any)

    const result = await extractWithTools({
      html,
      fields,
      schema,
      model: fakeModel,
      maxToolCalls: 3,
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('EXTRACTION_FAILED')
    }
  })

  it('passes maxToolCalls to stopWhen', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: '',
      steps: [],
    } as any)

    await extractWithTools({
      html,
      fields,
      schema,
      model: fakeModel,
      maxToolCalls: 7,
    })

    expect(mockGenerateText).toHaveBeenCalledOnce()
    const callArgs = mockGenerateText.mock.calls[0][0] as any
    expect(callArgs.stopWhen).toBeDefined()
  })

  it('passes cached mappings as hint in prompt', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: '',
      steps: [
        {
          toolCalls: [{
            toolName: 'submitResult',
            args: {
              mappings: {
                title: { selector: 'h1', transform: 'value.trim()' },
                price: { selector: '.price', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
              },
            },
          }],
          toolResults: [{
            toolName: 'submitResult',
            result: { valid: true, data: { title: 'Product', price: 10 } },
          }],
        },
      ],
    } as any)

    const cachedMappings = {
      title: { selector: 'h1', transform: 'value.trim()' },
      price: { selector: '.old-price', transform: 'parseFloat(value)' },
    }

    await extractWithTools({
      html,
      fields,
      schema,
      model: fakeModel,
      maxToolCalls: 3,
      cachedMappings,
    })

    const callArgs = mockGenerateText.mock.calls[0][0] as any
    expect(callArgs.prompt).toContain('previously worked')
    expect(callArgs.prompt).toContain('.old-price')
  })
})
