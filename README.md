# Pluckr

Schema-first, self-healing HTML data extraction powered by LLMs. Define what you want with a Zod schema, and Pluckr figures out how to extract it — no selectors to write, no scraper to maintain.

## Why Pluckr?

Traditional scrapers break when websites change. Pluckr uses an LLM to generate CSS selectors, validates them against your Zod schema, caches what works, and automatically heals when pages change. You write the schema once and never touch selectors again.

## Quick Start

```bash
npm install @pluckr/core @ai-sdk/google zod
```

```typescript
import { Pluckr } from '@pluckr/core'
import { google } from '@ai-sdk/google'
import { z } from 'zod'

const pluckr = new Pluckr({
  model: google('gemini-2.5-pro'),
})

const result = await pluckr.extract({
  html: '<html>...</html>',  // BYO HTML from any source
  schema: z.object({
    title: z.string(),
    price: z.coerce.number().positive(),
    inStock: z.coerce.boolean(),
  }),
  cacheKey: 'product-page',
})

if (result.success) {
  console.log(result.data)
  // { title: "A Light in the Attic", price: 51.77, inStock: true }
}

await pluckr.close()
```

## How It Works

1. You provide raw HTML and a Zod schema describing the data you want
2. An LLM generates CSS selectors for each field via an agentic tool loop
3. Selectors are tested and validated before being committed
4. Working selectors are cached — subsequent extractions are instant (zero LLM calls)
5. If selectors break due to page changes, Pluckr self-heals automatically

## Packages

| Package | Description |
|---------|-------------|
| [`@pluckr/core`](./packages/core) | Core extraction library |
| [`@pluckr/sqlite`](./packages/sqlite) | SQLite storage — persistent caching to disk |
| [`@pluckr/redis`](./packages/redis) | Redis storage — shared caching for distributed deployments |

## Installation

```bash
npm install @pluckr/core zod
```

Pick an AI provider ([any Vercel AI SDK provider works](https://sdk.vercel.ai/providers)):

```bash
npm install @ai-sdk/google      # or @ai-sdk/anthropic, @ai-sdk/openai
```

Add a storage backend for persistent caching (optional):

```bash
npm install @pluckr/sqlite       # file-based, single-process
npm install @pluckr/redis        # distributed, multi-process
```

## Key Features

- **Schema-first** — define what you want with Zod, get fully typed results
- **Self-healing** — selectors automatically repair when pages change
- **BYO HTML** — bring your own HTML from any source (fetch, Puppeteer, Playwright, curl)
- **BYO model** — works with any Vercel AI SDK model (Google, Anthropic, OpenAI, etc.)
- **Pluggable storage** — in-memory default, SQLite and Redis included, or implement `Storage` for any backend
- **No exceptions** — `extract()` returns a discriminated union (`success: true | false`)

## Storage Backends

**In-memory** (default) — no setup, cache lives for the process lifetime:

```typescript
const pluckr = new Pluckr({ model })
```

**SQLite** — persists selectors to disk across restarts:

```typescript
import { SqliteStorage } from '@pluckr/sqlite'

const pluckr = new Pluckr({
  model,
  storage: new SqliteStorage(),  // .pluckr/cache.db
})
```

**Redis** — shared cache for distributed deployments:

```typescript
import { RedisStorage } from '@pluckr/redis'

const pluckr = new Pluckr({
  model,
  storage: new RedisStorage({ url: 'redis://localhost:6379', ttl: 86400 }),
})
```

## Examples

Standalone, runnable examples for different use cases:

| Example | Description |
|---------|-------------|
| [`with-fetch`](./examples/with-fetch) | Simplest setup — native `fetch()` |
| [`with-cheerio`](./examples/with-cheerio) | Pre-process HTML before extraction |
| [`with-playwright`](./examples/with-playwright) | Extract from JS-rendered SPAs |
| [`with-puppeteer`](./examples/with-puppeteer) | Stealth browser with bot-detection avoidance |
| [`with-sqlite`](./examples/with-sqlite) | Persistent caching across runs |
| [`with-redis`](./examples/with-redis) | Shared caching with TTL |

```bash
cd examples/with-fetch
npm install
echo "GOOGLE_GENERATIVE_AI_API_KEY=your-key" > .env
npm start
```

## Documentation

- [`@pluckr/core` API docs](./packages/core/README.md)
- [`@pluckr/sqlite` setup](./packages/sqlite/README.md)
- [`@pluckr/redis` setup](./packages/redis/README.md)

## Development

```bash
npm install          # install all workspace dependencies
npm run build        # build all packages
npm test             # run all tests (65 tests, fully mocked)
```

## License

MIT
