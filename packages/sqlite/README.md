# @pluckr/sqlite

SQLite storage backend for [`@pluckr/core`](https://www.npmjs.com/package/@pluckr/core). Persists selector caches to disk so repeated extractions skip the LLM entirely.

## Installation

```bash
npm install @pluckr/core @pluckr/sqlite
```

## Usage

```typescript
import { Pluckr } from '@pluckr/core'
import { SqliteStorage } from '@pluckr/sqlite'
import { anthropic } from '@ai-sdk/anthropic'

const pluckr = new Pluckr({
  model: anthropic('claude-haiku-4-5-20251001'),
  storage: new SqliteStorage(),  // defaults to .pluckr/cache.db
})

const result = await pluckr.extract({
  html: '<html>...</html>',
  schema: ProductSchema,
  cacheKey: 'my-product-page',
})

await pluckr.close()
```

## Custom path

```typescript
new SqliteStorage('/path/to/custom/cache.db')
```

## Clearing the cache

```bash
rm -rf .pluckr/
```

## What it stores

| Column | Description |
|--------|-------------|
| `key` | The `cacheKey` you pass to `extract()` |
| `schema_hash` | SHA256 hash of your Zod schema fields |
| `selectors` | JSON field mappings (CSS selectors + transforms) |
| `consecutive_failures` | Failure count (triggers `PERMANENT_FAILURE` after 4) |

## License

MIT
