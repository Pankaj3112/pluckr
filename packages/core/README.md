# @pluckr/core

Schema-first, self-healing HTML data extraction powered by LLMs. Define what you want with a Zod schema, and Pluckr figures out how to extract it.

## Installation

```bash
npm install @pluckr/core
```

You also need an AI SDK provider:

```bash
npm install @ai-sdk/anthropic   # or @ai-sdk/openai, @ai-sdk/google
```

## Quick Start

```typescript
import { Pluckr } from '@pluckr/core'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'

const pluckr = new Pluckr({
  model: anthropic('claude-haiku-4-5-20251001'),
})

const result = await pluckr.extract({
  html: '<html>...</html>',
  schema: z.object({
    title: z.string(),
    price: z.coerce.number().positive(),
    inStock: z.coerce.boolean(),
  }),
  cacheKey: 'my-product-page',
})

if (result.success) {
  console.log(result.data.title)  // fully typed!
}

await pluckr.close()
```

## How it works

1. You provide HTML and a Zod schema describing the data you want
2. An LLM generates CSS selectors for each schema field
3. Selectors are tested and verified via an agentic tool loop
4. Zod validates and coerces the extracted data
5. Working selectors are cached — subsequent extractions are instant (no LLM calls)
6. If the page changes and selectors break, Pluckr asks the LLM to fix them

## Bring your own model

Pluckr accepts any [Vercel AI SDK](https://sdk.vercel.ai) compatible model:

```typescript
import { anthropic } from '@ai-sdk/anthropic'
import { openai } from '@ai-sdk/openai'
import { google } from '@ai-sdk/google'

new Pluckr({ model: anthropic('claude-haiku-4-5-20251001') })
new Pluckr({ model: openai('gpt-4o-mini') })
new Pluckr({ model: google('gemini-2.0-flash') })
```

## Use `z.coerce` for non-string fields

CSS selectors extract text from HTML, so all raw values are strings. Use `z.coerce.number()`, `z.coerce.boolean()`, etc. so Zod converts `"29.99"` to `29.99` and `"true"` to `true`.

## Caching

By default, Pluckr uses in-memory storage (cache lives for the process lifetime). For persistent caching:

**SQLite** — single-process, file-based ([`@pluckr/sqlite`](https://www.npmjs.com/package/@pluckr/sqlite)):

```typescript
import { SqliteStorage } from '@pluckr/sqlite'

const pluckr = new Pluckr({
  model,
  storage: new SqliteStorage(),  // defaults to .pluckr/cache.db
})
```

**Redis** — distributed, multi-process ([`@pluckr/redis`](https://www.npmjs.com/package/@pluckr/redis)):

```typescript
import { RedisStorage } from '@pluckr/redis'

const pluckr = new Pluckr({
  model,
  storage: new RedisStorage({ url: 'redis://localhost:6379', ttl: 86400 }),
})
```

You can also implement the `Storage` interface for any custom backend.

## Error Handling

`extract()` returns a discriminated union — no exceptions:

```typescript
const result = await pluckr.extract({ html, schema, cacheKey: 'my-page' })

if (result.success) {
  console.log(result.data)
} else {
  // result.error.code: 'NO_DATA' | 'EXTRACTION_FAILED' | 'PERMANENT_FAILURE'
  console.error(result.error.message)
}
```

## API

### `new Pluckr(config)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `LanguageModel` | required | Any Vercel AI SDK model |
| `storage` | `Storage` | `MemoryStorage` | Cache backend |
| `debug` | `boolean` | `false` | Log extraction steps |
| `maxToolCallsPerField` | `number` | `3` | Max LLM tool calls per schema field |

### `pluckr.extract(options)`

| Option | Type | Description |
|--------|------|-------------|
| `html` | `string` | Raw HTML to extract from |
| `schema` | `ZodObject` | Zod schema describing desired data |
| `cacheKey` | `string?` | Optional key for selector caching |

Returns `ExtractResult<T>`: `{ success: true, data: T }` or `{ success: false, error: ExtractError }`.

## License

MIT
