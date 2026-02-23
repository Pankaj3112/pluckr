import { describe, it, expect } from 'vitest'
import { runSelectors } from '../selector.js'
import type { FieldMappings } from '../types.js'

const HTML = `
<html>
<body>
  <h1 class="product-title">Widget Pro</h1>
  <span data-price="29.99">$29.99</span>
  <div class="rating" aria-label="4.5 out of 5">★★★★½</div>
  <span id="availability">In Stock</span>
  <input type="hidden" name="sku" value="SKU-123" />
  <img class="product-img" alt="Widget Pro front view" src="img.jpg" />
  <a class="brand-link" href="https://brand.com">BrandCo</a>
</body>
</html>
`

describe('runSelectors', () => {
  it('extracts text and applies string transform', () => {
    const mappings: FieldMappings = {
      title: { selector: 'h1.product-title', transform: 'value.trim()' },
    }
    const result = runSelectors(HTML, mappings)
    expect(result.title).toBe('Widget Pro')
  })

  it('extracts text and applies number transform', () => {
    const mappings: FieldMappings = {
      price: { selector: '[data-price]', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
    }
    const result = runSelectors(HTML, mappings)
    expect(result.price).toBe(29.99)
  })

  it('extracts text and applies boolean transform', () => {
    const mappings: FieldMappings = {
      inStock: { selector: '#availability', transform: "value.toLowerCase().includes('in stock')" },
    }
    const result = runSelectors(HTML, mappings)
    expect(result.inStock).toBe(true)
  })

  it('extracts aria-label when present', () => {
    const mappings: FieldMappings = {
      rating: { selector: '.rating[aria-label]', transform: 'parseFloat(value)' },
    }
    const result = runSelectors(HTML, mappings)
    expect(result.rating).toBe(4.5)
  })

  it('extracts value from input elements', () => {
    const mappings: FieldMappings = {
      sku: { selector: 'input[name="sku"]', transform: 'value.trim()' },
    }
    const result = runSelectors(HTML, mappings)
    expect(result.sku).toBe('SKU-123')
  })

  it('extracts alt from img elements', () => {
    const mappings: FieldMappings = {
      image: { selector: 'img.product-img', transform: 'value.trim()' },
    }
    const result = runSelectors(HTML, mappings)
    expect(result.image).toBe('Widget Pro front view')
  })

  it('extracts href from anchor elements', () => {
    const mappings: FieldMappings = {
      brand: { selector: 'a.brand-link', transform: 'value.trim()' },
    }
    const result = runSelectors(HTML, mappings)
    expect(result.brand).toBe('https://brand.com')
  })

  it('returns null for selectors with no matches', () => {
    const mappings: FieldMappings = {
      missing: { selector: '.nonexistent', transform: 'value.trim()' },
    }
    const result = runSelectors(HTML, mappings)
    expect(result.missing).toBeNull()
  })

  it('returns null when transform throws', () => {
    const mappings: FieldMappings = {
      title: { selector: 'h1.product-title', transform: 'value.nonExistentMethod()' },
    }
    const result = runSelectors(HTML, mappings)
    expect(result.title).toBeNull()
  })

  it('handles multiple fields at once', () => {
    const mappings: FieldMappings = {
      title: { selector: 'h1.product-title', transform: 'value.trim()' },
      price: { selector: '[data-price]', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
      stock: { selector: '#availability', transform: 'value.trim()' },
    }
    const result = runSelectors(HTML, mappings)
    expect(result.title).toBe('Widget Pro')
    expect(result.price).toBe(29.99)
    expect(result.stock).toBe('In Stock')
  })
})
