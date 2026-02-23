# healscrape — Design Document

**Date:** 2026-02-23

## Overview

A TypeScript library for schema-first, self-healing web scraping using LLM-generated CSS selectors. Users provide a URL and a Zod schema; the library fetches the page, uses an LLM to generate CSS selectors for each schema field, extracts data, validates with Zod, and caches working selectors in SQLite. LLM is only called on cache miss or validation failure.

## Architecture

```
User → Scraper.scrape(url, schema)
  → Cache check → hit? → run selectors → validate → return typed data
  → Cache miss? → fetch page → clean HTML → LLM generates selectors
    → run selectors → validate → pass? → cache & return
    → fail? → LLM fixes selectors → retry → pass? → cache & return
    → still fail? → throw ExtractionFailed
```

Single entry point: `Scraper` class. All state (DB connection, LLM config) lives on the instance. No globals.

## Modules

| Module | Responsibility | Key Export |
|--------|---------------|------------|
| `scraper.ts` | Orchestration loop | `Scraper` class |
| `fetcher.ts` | Playwright fetch + cheerio HTML cleaning | `fetchAndClean(url)` |
| `selector.ts` | Run CSS selectors via cheerio | `runSelectors(html, selectors)` |
| `llm.ts` | Vercel AI SDK `generateObject` calls | `generateSelectors()`, `fixSelectors()` |
| `cache.ts` | better-sqlite3 read/write | `SelectorCache` class |
| `validator.ts` | Zod safeParse + error formatting | `validate(schema, data)` |
| `exceptions.ts` | Custom error classes | `ExtractionFailed`, `PermanentFailure` |
| `prompts.ts` | Prompt template strings | Constants |
| `index.ts` | Public exports | Re-exports |

## API

```typescript
import { Scraper } from 'healscrape'
import { z } from 'zod'

const scraper = new Scraper({
  provider: 'anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-haiku-4-5-20251001',
  cachePath?: string,  // optional, defaults to .healscrape/cache.db
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
```

## Key Design Decisions

### Schema Hashing
Derive from `schema.shape` (field names + Zod type names), hashed with `crypto.createHash('sha256')`. Stable across Zod minor versions. Avoids accessing Zod internals (`_def`).

### Single Healing Attempt
One retry with LLM-fixed selectors. No configurable retry count. Simple, predictable, avoids burning tokens on hopeless pages.

### PermanentFailure Guard
Check `consecutive_failures > 3` at the start of `scrape()`, before fetching the page. Saves a page load and LLM call for known-broken combos. User clears cache to retry.

### HTML Cleaning via Cheerio
Same dependency used for selector extraction. Handles:
- Tag removal: `script, style, svg, noscript, iframe`
- Hidden element removal: inline `display:none`/`visibility:hidden`, classes `.hidden`, `.d-none`, `.sr-only`
- Attribute stripping: keep only `id`, `class`, `data-*`, `aria-label`, `placeholder`, `alt`, `href`, `src`, `value`

### Cache Location
`.healscrape/cache.db` in `process.cwd()`. `SelectorCache` accepts optional `dbPath` for testing.

## Module Details

### fetcher.ts — `fetchAndClean(url: string): Promise<string>`
- Launch Playwright chromium, navigate to URL, wait for `networkidle`
- Extract `page.content()`
- Clean with cheerio (tag removal, hidden element removal, attribute stripping)
- Close browser, return cleaned HTML

### selector.ts — `runSelectors(html: string, selectors: Record<string, string>): Record<string, string | null>`
- Load HTML in cheerio
- For each selector, find first match and extract:
  - `<input>/<textarea>/<select>`: `value` attribute
  - `<img>`: `alt` attribute
  - `<a>`: `href` attribute
  - Element with `aria-label`: prefer `aria-label`
  - Default: `.text().trim()`
- Return `null` for selectors matching zero elements

### llm.ts
- `generateSelectors(html, schemaFields, llmConfig)` — generates CSS selectors from cleaned HTML + schema field info
- `fixSelectors(html, prevSelectors, errors, rawData, llmConfig)` — fixes broken selectors given failure context
- Both use Vercel AI SDK `generateObject` with structured output
- Both return `Record<string, string>`

### cache.ts — `SelectorCache` class
```sql
CREATE TABLE selector_cache (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL,
  schema_hash TEXT NOT NULL,
  selectors TEXT NOT NULL,
  consecutive_failures INTEGER DEFAULT 0,
  last_success_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(url, schema_hash)
)
```
Methods: `get`, `set`, `getFailureCount`, `incrementFailures`, `resetFailures`. Auto-creates directory and table on first use.

### validator.ts — `validate<T>(schema, data): ValidationResult<T>`
- Uses `schema.safeParse(data)`
- On failure: formats Zod issues into human-readable string with field name, expected type, received value, error message

### exceptions.ts
- `ExtractionFailed`: url, errors, rawData, selectors. Thrown after healing fails.
- `PermanentFailure`: url, failureCount. Thrown at start when consecutive_failures > 3.

### prompts.ts
All prompt template strings as exported constants. Not inline in llm.ts.

## Dependencies

```json
{
  "dependencies": {
    "ai": "^4",
    "@ai-sdk/anthropic": "^1",
    "@ai-sdk/openai": "^1",
    "zod": "^3",
    "playwright": "^1",
    "cheerio": "^1",
    "better-sqlite3": "^11"
  },
  "devDependencies": {
    "typescript": "^5",
    "@types/better-sqlite3": "^7",
    "tsup": "^8"
  }
}
```

## Error Handling
- `ExtractionFailed`: human-readable message with URL and validation errors
- `PermanentFailure`: tells user site structure may have changed, clear cache to retry
- Playwright errors (timeout, navigation): bubble up as-is
- LLM errors (rate limit, auth): bubble up as-is
