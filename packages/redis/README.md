# @pluckr/redis

Redis storage backend for [`@pluckr/core`](https://www.npmjs.com/package/@pluckr/core). Persists selector caches in Redis so repeated extractions skip the LLM entirely. Ideal for distributed deployments where multiple instances share the same cache.

## Installation

```bash
npm install @pluckr/core @pluckr/redis
```

## Usage

```typescript
import { Pluckr } from '@pluckr/core'
import { RedisStorage } from '@pluckr/redis'
import { anthropic } from '@ai-sdk/anthropic'

const pluckr = new Pluckr({
  model: anthropic('claude-haiku-4-5-20251001'),
  storage: new RedisStorage(),  // defaults to localhost:6379
})

const result = await pluckr.extract({
  html: '<html>...</html>',
  schema: ProductSchema,
  cacheKey: 'my-product-page',
})

await pluckr.close()
```

## Options

```typescript
new RedisStorage({
  url: 'redis://user:pass@host:6379',  // connection URL
  prefix: 'pluckr:',                    // key prefix (default)
  ttl: 60 * 60 * 24,                    // expire after 24h (default: no expiry)
})
```

## BYO Redis instance

```typescript
import Redis from 'ioredis'

const redis = new Redis({ host: 'cache.internal', port: 6379 })

const storage = new RedisStorage({ redis })
// close() is a no-op — you manage the connection lifecycle
```

## What it stores

Each cache entry is a JSON string stored at `pluckr:{cacheKey}:{schemaHash}`:

| Field | Description |
|-------|-------------|
| `fieldMappings` | CSS selectors + transforms for each schema field |
| `consecutiveFailures` | Failure count (triggers `PERMANENT_FAILURE` after 4) |

## Clearing the cache

```bash
# All pluckr keys
redis-cli KEYS "pluckr:*" | xargs redis-cli DEL

# Specific key
redis-cli DEL "pluckr:my-product-page:abc123"
```

## License

MIT
