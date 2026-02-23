# BYO HTML: Remove Built-in Fetcher, Accept Raw HTML

## Problem

healscrape currently bundles playwright-ghost for stealth page fetching. This creates problems:
- Heavy dependency (browser binary downloads on install)
- Users already have their own fetching solutions (proxies, Puppeteer, curl, etc.)
- Fetching is a solved problem — healscrape's value is extraction, not fetching

## Decision

Remove the built-in fetcher entirely. Users pass raw HTML to `scrape()`. healscrape becomes a pure schema-first extraction library.

## New API

```ts
const scraper = new Scraper({ model })

// With caching (repeated scrapes of the same source)
const result = await scraper.scrape({
  html: '<html>...</html>',
  schema: mySchema,
  cacheKey: 'amazon-product-123',
})

// Without caching (one-off extraction)
const result = await scraper.scrape({
  html: '<html>...</html>',
  schema: mySchema,
})
```

### ScrapeOptions changes

| Field | Before | After |
|-------|--------|-------|
| `url` | required | removed |
| `html` | n/a | required (raw HTML string) |
| `cacheKey` | n/a | optional (enables selector caching) |
| `schema` | required | required (unchanged) |

### ScraperConfig

No changes. `model`, `cachePath`, `debug`, `maxToolCallsPerField` all remain.

## HTML Cleaning

`cleanHtml` is kept and always applied internally to the user's HTML before LLM extraction. It strips scripts, styles, hidden elements, and irrelevant attributes to reduce token usage.

- `cleanHtml` exported publicly from `index.ts` for standalone use
- `fetcher.ts` renamed to `cleaner.ts` (only contains `cleanHtml` and helpers)
- `fetchAndClean` deleted

## Caching

- When `cacheKey` provided: cache key = `(cacheKey, schemaHash)`, full cache behavior
- When `cacheKey` omitted: all cache operations skipped (no read, write, or failure tracking)
- Permanent failure guard only applies when `cacheKey` is provided

## Dependencies Removed

- `playwright` — no longer needed
- `playwright-ghost` — no longer needed

Remaining deps: `cheerio`, `better-sqlite3`, `ai`, `zod`

## Error Codes

`FETCH_FAILED` removed from `ScrapeError.code` union. Remaining codes: `NO_DATA`, `EXTRACTION_FAILED`, `PERMANENT_FAILURE`.

## Files Changed

| File | Change |
|------|--------|
| `src/fetcher.ts` | Rename to `src/cleaner.ts`, delete `fetchAndClean`, keep `cleanHtml` |
| `src/scraper.ts` | New `ScrapeOptions` type, use `cleanHtml` instead of `fetchAndClean`, use `cacheKey` for cache ops, skip cache when no `cacheKey` |
| `src/types.ts` | Remove `FETCH_FAILED` from `ScrapeError.code` |
| `src/index.ts` | Export `cleanHtml`, update import from `cleaner.ts` |
| `package.json` | Remove `playwright`, `playwright-ghost` deps |
| `CLAUDE.md` | Update architecture docs |
| `src/__tests__/*` | Update all tests for new API |
