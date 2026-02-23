import { describe, it, expect } from 'vitest'
import {
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionPrompt,
  buildCachedHintPrompt,
  type FieldInfo,
} from '../src/prompts.js'

describe('EXTRACTION_SYSTEM_PROMPT', () => {
  it('mentions testSelector tool', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('testSelector')
  })

  it('mentions submitResult tool', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('submitResult')
  })

  it('mentions reportNoData tool', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('reportNoData')
  })
})

describe('buildExtractionPrompt', () => {
  it('includes HTML and field list', () => {
    const html = '<html><body><h1>Test</h1></body></html>'
    const fields: FieldInfo[] = [
      { name: 'title', type: 'ZodString' },
      { name: 'price', type: 'ZodNumber', description: 'strip currency' },
    ]
    const result = buildExtractionPrompt(html, fields)

    expect(result).toContain('<html>')
    expect(result).toContain('Test')
    expect(result).toContain('"title"')
    expect(result).toContain('ZodString')
    expect(result).toContain('"price"')
    expect(result).toContain('strip currency')
  })
})

describe('buildCachedHintPrompt', () => {
  it('includes HTML, fields, and cached mappings', () => {
    const html = '<html><body><h1>Test</h1></body></html>'
    const fields: FieldInfo[] = [{ name: 'title', type: 'ZodString' }]
    const cached = { title: { selector: 'h1', transform: 'value.trim()' } }
    const result = buildCachedHintPrompt(html, fields, cached)

    expect(result).toContain('previously worked')
    expect(result).toContain('h1')
    expect(result).toContain('value.trim()')
  })
})
