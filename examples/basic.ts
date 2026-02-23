import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { Scraper } from '../src/index.js'

const scraper = new Scraper({
  model: anthropic('claude-haiku-4-5-20251001'),
})

const ArticleSchema = z.object({
  title: z.string(),
  author: z.string(),
  publishDate: z.string(),
})

async function main() {
  try {
    const article = await scraper.scrape({
      url: 'https://example.com/blog/post',
      schema: ArticleSchema,
    })
    console.log('Extracted:', article)
  } catch (err) {
    console.error('Failed:', err)
  } finally {
    scraper.close()
  }
}

main()
