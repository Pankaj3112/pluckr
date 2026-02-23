import { describe, it, expect } from 'vitest'
import type { ScrapeResult, ScrapeError } from '../types.js'

describe('ScrapeResult type', () => {
  it('narrows to success branch', () => {
    const result: ScrapeResult<{ title: string }> = {
      success: true,
      data: { title: 'Widget' },
    }
    if (result.success) {
      expect(result.data.title).toBe('Widget')
    }
  })

  it('narrows to error branch', () => {
    const result: ScrapeResult<{ title: string }> = {
      success: false,
      error: {
        code: 'NO_DATA',
        message: 'Page does not contain product data',
      },
    }
    if (!result.success) {
      expect(result.error.code).toBe('NO_DATA')
      expect(result.error.message).toContain('product data')
    }
  })

  it('error branch supports partialData', () => {
    const result: ScrapeResult<{ title: string; price: number }> = {
      success: false,
      error: {
        code: 'EXTRACTION_FAILED',
        message: 'Could not extract price',
        partialData: { title: 'Widget' },
      },
    }
    if (!result.success) {
      expect(result.error.partialData).toEqual({ title: 'Widget' })
    }
  })
})
