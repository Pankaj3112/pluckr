# @pluckr/core

Schema-first, self-healing HTML data extraction powered by LLMs. Define what you want with a Zod schema, and Pluckr figures out how to extract it.

## How it works

1. You provide HTML and a Zod schema describing the data you want
2. An LLM generates CSS selectors for each schema field
3. Selectors are tested and verified via a tool loop
4. Selectors are run against the HTML to extract raw values
5. Zod validates and coerces the extracted data
6. Working selectors are cached — subsequent runs are free (no LLM calls)
7. If the page changes and selectors break, Pluckr asks the LLM to fix them

## Installation

```bash
npm install @pluckr/core
```

You also need an AI SDK provider package for the LLM of your choice:

```bash
# Pick one (or more)
npm install @ai-sdk/anthropic
npm install @ai-sdk/openai
npm install @ai-sdk/google
```

For persistent caching with SQLite:

```bash
npm install @pluckr/sqlite
```

## Quick Start

```typescript
import { Pluckr } from '@pluckr/core'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'

const pluckr = new Pluckr({
  model: anthropic('claude-haiku-4-5-20251001'),
})

const ProductSchema = z.object({
  title: z.string(),
  price: z.coerce.number().positive(),
  rating: z.coerce.number().min(0).max(5),
  inStock: z.coerce.boolean(),
})

const result = await pluckr.extract({
  html: '<html>...</html>',
  schema: ProductSchema,
  cacheKey: 'my-product-page',
})

if (result.success) {
  console.log(result.data.title)  // fully typed!
}

// Close when done to release resources
await pluckr.close()
```

## Bring your own model

Pluckr accepts any [Vercel AI SDK](https://sdk.vercel.ai) compatible model:

```typescript
import { anthropic } from '@ai-sdk/anthropic'
import { openai } from '@ai-sdk/openai'
import { google } from '@ai-sdk/google'

// Anthropic
new Pluckr({ model: anthropic('claude-haiku-4-5-20251001') })

// OpenAI
new Pluckr({ model: openai('gpt-4o-mini') })

// Google
new Pluckr({ model: google('gemini-2.0-flash') })
```

## Important: Use `z.coerce` for non-string fields

CSS selectors extract text from HTML, which means all raw values are strings. Use `z.coerce.number()`, `z.coerce.boolean()`, etc. instead of `z.number()`, `z.boolean()` so Zod can convert `"29.99"` → `29.99` and `"true"` → `true`.

## Caching

By default, Pluckr uses in-memory storage. For persistent caching, use `@pluckr/sqlite`:

```typescript
import { Pluckr } from '@pluckr/core'
import { SqliteStorage } from '@pluckr/sqlite'

const pluckr = new Pluckr({
  model: anthropic('claude-haiku-4-5-20251001'),
  storage: new SqliteStorage(),  // defaults to .pluckr/cache.db
})
```

- **First extraction** of a cacheKey+schema combo calls the LLM (~1-2s)
- **Subsequent extractions** use cached selectors (instant, free)
- **If selectors break** (page changed), Pluckr automatically asks the LLM to fix them
- **After 4 consecutive failures**, returns `PERMANENT_FAILURE` to avoid wasting tokens

### Clearing the cache

Delete the cache file to start fresh:

```bash
rm -rf .pluckr/
```

## Error Handling

```typescript
const result = await pluckr.extract({ html, schema, cacheKey: 'my-page' })

if (result.success) {
  console.log(result.data)
} else {
  switch (result.error.code) {
    case 'NO_DATA':
      // Page doesn't contain the requested data
      break
    case 'EXTRACTION_FAILED':
      // LLM couldn't generate working selectors
      break
    case 'PERMANENT_FAILURE':
      // Too many consecutive failures — clear cache to retry
      break
  }
}
```

## License

MIT
