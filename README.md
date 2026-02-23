# Pluckr

Schema-first, self-healing HTML data extraction powered by LLMs. Define what you want with a Zod schema, and Pluckr figures out how to extract it.

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
  cacheKey: 'product-page',
})

if (result.success) {
  console.log(result.data.title)  // fully typed!
}
```

## How it works

1. You provide HTML and a Zod schema
2. An LLM generates CSS selectors for each field via an agentic tool loop
3. Selectors are tested, validated, and cached
4. Subsequent extractions use cached selectors (instant, no LLM calls)
5. If selectors break, Pluckr self-heals by asking the LLM to fix them

## Packages

| Package | Description |
|---------|-------------|
| [`@pluckr/core`](./packages/core) | Core extraction library |
| [`@pluckr/sqlite`](./packages/sqlite) | SQLite storage backend for persistent caching |

## Installation

```bash
npm install @pluckr/core
npm install @ai-sdk/anthropic   # or @ai-sdk/openai, @ai-sdk/google
```

For persistent caching:

```bash
npm install @pluckr/sqlite
```

## Key features

- **Schema-first** — define what you want with Zod, get fully typed results
- **Self-healing** — selectors automatically repair when pages change
- **BYO HTML** — bring your own HTML from any source (Puppeteer, Playwright, curl, etc.)
- **BYO model** — works with any Vercel AI SDK model (Anthropic, OpenAI, Google, etc.)
- **Pluggable storage** — in-memory default, SQLite included, implement `Storage` for anything else
- **No exceptions** — `extract()` returns a discriminated union (`success: true | false`)

## Documentation

- [`@pluckr/core` README](./packages/core/README.md) — full API docs, examples, and configuration
- [`@pluckr/sqlite` README](./packages/sqlite/README.md) — SQLite storage setup

## Development

```bash
npm install                                # install all workspace dependencies
npm test                                   # run all tests
npm test --workspace=@pluckr/core          # run core tests
npm run build                              # build all packages
```

## License

MIT
