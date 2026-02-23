import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { validate } from '../src/validator.js'

describe('validate', () => {
  const schema = z.object({
    title: z.string(),
    price: z.coerce.number().positive(),
    inStock: z.coerce.boolean(),
  })

  it('returns success with parsed data when valid', () => {
    const result = validate(schema, {
      title: 'Widget',
      price: '29.99',
      inStock: 'true',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({
        title: 'Widget',
        price: 29.99,
        inStock: true,
      })
    }
  })

  it('returns failure with formatted errors when invalid', () => {
    const result = validate(schema, {
      title: 'Widget',
      price: 'not-a-number',
      inStock: 'true',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors).toContain('price')
      expect(result.rawData).toEqual({
        title: 'Widget',
        price: 'not-a-number',
        inStock: 'true',
      })
    }
  })

  it('returns failure when required fields are null', () => {
    const result = validate(schema, {
      title: null,
      price: '10',
      inStock: 'true',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors).toContain('title')
    }
  })
})
