import { describe, it, expect } from 'vitest'
import { ExtractionFailed, PermanentFailure } from '../exceptions.js'

describe('ExtractionFailed', () => {
  it('stores context and formats message', () => {
    const err = new ExtractionFailed({
      url: 'https://example.com',
      errors: 'price: Expected number, received NaN',
      rawData: { title: 'Widget', price: 'N/A' },
      selectors: { title: 'h1', price: '.price' },
    })

    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ExtractionFailed')
    expect(err.message).toContain('https://example.com')
    expect(err.message).toContain('price: Expected number, received NaN')
    expect(err.url).toBe('https://example.com')
    expect(err.errors).toBe('price: Expected number, received NaN')
    expect(err.rawData).toEqual({ title: 'Widget', price: 'N/A' })
    expect(err.selectors).toEqual({ title: 'h1', price: '.price' })
  })
})

describe('PermanentFailure', () => {
  it('stores context and formats message', () => {
    const err = new PermanentFailure({
      url: 'https://example.com',
      failureCount: 4,
    })

    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('PermanentFailure')
    expect(err.message).toContain('https://example.com')
    expect(err.message).toContain('4')
    expect(err.message).toContain('cache')
    expect(err.url).toBe('https://example.com')
    expect(err.failureCount).toBe(4)
  })
})
