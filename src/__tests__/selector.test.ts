import { describe, it, expect } from 'vitest'
import { runSelectors } from '../selector.js'

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
  it('extracts text content by default', () => {
    const result = runSelectors(HTML, { title: 'h1.product-title' })
    expect(result.title).toBe('Widget Pro')
  })

  it('extracts aria-label when present', () => {
    const result = runSelectors(HTML, { rating: '.rating[aria-label]' })
    expect(result.rating).toBe('4.5 out of 5')
  })

  it('extracts value from input elements', () => {
    const result = runSelectors(HTML, { sku: 'input[name="sku"]' })
    expect(result.sku).toBe('SKU-123')
  })

  it('extracts alt from img elements', () => {
    const result = runSelectors(HTML, { image: 'img.product-img' })
    expect(result.image).toBe('Widget Pro front view')
  })

  it('extracts href from anchor elements', () => {
    const result = runSelectors(HTML, { brand: 'a.brand-link' })
    expect(result.brand).toBe('https://brand.com')
  })

  it('returns null for selectors with no matches', () => {
    const result = runSelectors(HTML, { missing: '.nonexistent' })
    expect(result.missing).toBeNull()
  })

  it('handles multiple selectors at once', () => {
    const result = runSelectors(HTML, {
      title: 'h1.product-title',
      price: '[data-price]',
      stock: '#availability',
    })
    expect(result.title).toBe('Widget Pro')
    expect(result.price).toBe('$29.99')
    expect(result.stock).toBe('In Stock')
  })
})
