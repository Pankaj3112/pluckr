import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { Scraper, ExtractionFailed } from '../src/index.js'

const scraper = new Scraper({
  model: anthropic('claude-haiku-4-5-20251001'),
})

// Use z.coerce for fields extracted as strings from HTML
const ProductSchema = z.object({
  title: z.string(),
  price: z.coerce.number().positive(),
  rating: z.coerce.number().min(0).max(5),
  inStock: z.coerce.boolean(),
})

async function main() {
  try {
    const product = await scraper.scrape({
      url: 'https://example.com/product/widget-pro',
      schema: ProductSchema,
    })

    console.log(`${product.title}: $${product.price}`)
    console.log(`Rating: ${product.rating}/5`)
    console.log(`In stock: ${product.inStock}`)
  } catch (err) {
    if (err instanceof ExtractionFailed) {
      console.error('Extraction failed:', err.message)
      console.error('Raw data:', err.rawData)
      console.error('Selectors tried:', err.selectors)
    } else {
      throw err
    }
  } finally {
    scraper.close()
  }
}

main()
