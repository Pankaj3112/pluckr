# healscrape

Schema-first, self-healing web scraping powered by LLMs. Define what you want with a Zod schema, and healscrape figures out how to extract it.

## How it works

1. You provide a URL and a Zod schema describing the data you want
2. healscrape fetches the page with Playwright (handles JS rendering)
3. An LLM generates CSS selectors for each schema field
4. Selectors are run against the page to extract raw values
5. Zod validates and coerces the extracted data
6. Working selectors are cached in SQLite — subsequent runs are free (no LLM calls)
7. If the page changes and selectors break, healscrape asks the LLM to fix them

## Installation

```bash
npm install healscrape
npx playwright install chromium
```

You also need an AI SDK provider package for the LLM of your choice:

```bash
# Pick one (or more)
npm install @ai-sdk/anthropic
npm install @ai-sdk/openai
npm install @ai-sdk/google
```

## Quick Start

```typescript
import { Scraper } from 'healscrape'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'

const scraper = new Scraper({
  model: anthropic('claude-haiku-4-5-20251001'),
})

const ProductSchema = z.object({
  title: z.string(),
  price: z.coerce.number().positive(),
  rating: z.coerce.number().min(0).max(5),
  inStock: z.coerce.boolean(),
})

const product = await scraper.scrape({
  url: 'https://example.com/product',
  schema: ProductSchema,
})

console.log(product.title)  // fully typed!

// Close when done to release the SQLite connection
scraper.close()
```

## Bring your own model

healscrape accepts any [Vercel AI SDK](https://sdk.vercel.ai) compatible model. Pass it directly to the `Scraper` constructor:

```typescript
import { anthropic } from '@ai-sdk/anthropic'
import { openai } from '@ai-sdk/openai'
import { google } from '@ai-sdk/google'

// Anthropic
new Scraper({ model: anthropic('claude-haiku-4-5-20251001') })

// OpenAI
new Scraper({ model: openai('gpt-4o-mini') })

// Google
new Scraper({ model: google('gemini-2.0-flash') })
```

## Important: Use `z.coerce` for non-string fields

CSS selectors extract text from HTML, which means all raw values are strings. Use `z.coerce.number()`, `z.coerce.boolean()`, etc. instead of `z.number()`, `z.boolean()` so Zod can convert `"29.99"` → `29.99` and `"true"` → `true`.

## Caching

Working selectors are stored in `.healscrape/cache.db` (SQLite) in your project root. This means:

- **First scrape** of a URL+schema combo calls the LLM (~1-2s)
- **Subsequent scrapes** use cached selectors (instant, free)
- **If selectors break** (page changed), healscrape automatically asks the LLM to fix them
- **After 4 consecutive failures**, healscrape throws `PermanentFailure` to avoid wasting tokens

### Custom cache location

```typescript
const scraper = new Scraper({
  model: anthropic('claude-haiku-4-5-20251001'),
  cachePath: '/path/to/custom/cache.db',
})
```

### Clearing the cache

Delete the cache file to start fresh:

```bash
rm -rf .healscrape/
```

## Error Handling

```typescript
import { Scraper, ExtractionFailed, PermanentFailure } from 'healscrape'

try {
  const data = await scraper.scrape({ url, schema })
} catch (err) {
  if (err instanceof ExtractionFailed) {
    // LLM couldn't generate working selectors
    console.error(err.message)    // human-readable summary
    console.error(err.rawData)    // what was actually extracted
    console.error(err.selectors)  // the CSS selectors that were tried
  } else if (err instanceof PermanentFailure) {
    // Too many consecutive failures for this URL+schema
    // Clear the cache and try again, or check if the site changed
    console.error(err.message)
  }
}
```

## License

MIT
