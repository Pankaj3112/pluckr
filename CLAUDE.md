# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**healscrape** is a TypeScript library for schema-first, self-healing web scraping powered by LLMs. Users define a Zod schema, the library auto-generates CSS selectors via an LLM, extracts and validates data, caches working selectors in SQLite, and automatically heals broken selectors when pages change.

## Commands

```bash
npm run build          # Build ESM + CJS + type declarations to dist/
npm test               # Run all tests (vitest)
npm run test:watch     # Run tests in watch mode
npx vitest run src/__tests__/cache.test.ts   # Run a single test file
npx playwright install chromium              # Required for Playwright (first-time setup)
```

## Architecture

The scrape pipeline flows: **fetch → clean → generate field mappings (selector + transform) → extract & transform → validate → cache (or heal)**

```
Scraper.scrape(url, schema)
  ├─ SelectorCache: check for cached field mappings (SQLite)
  ├─ fetchAndClean: Playwright fetches page, cheerio strips noise
  ├─ generateFieldMappings: LLM creates CSS selector + JS transform per field
  ├─ runSelectors: cheerio runs selectors, applies transforms, extracts typed values
  ├─ validate: Zod safeParse
  ├─ Success → cache field mappings, return typed data
  └─ Failure → fixFieldMappings (LLM) → retry → throw ExtractionFailed
      └─ After 4+ consecutive failures → PermanentFailure (skips fetch/LLM)
```

### Key Modules (all in `src/`)

| Module | Role |
|--------|------|
| `scraper.ts` | Main orchestration class, public API |
| `cache.ts` | SQLite selector cache with failure tracking |
| `fetcher.ts` | Playwright page fetch + cheerio HTML cleaning |
| `selector.ts` | CSS selector execution + JS transform application |
| `llm.ts` | Vercel AI SDK wrapper: `generateFieldMappings` / `fixFieldMappings` |
| `validator.ts` | Zod validation wrapper with error formatting |
| `prompts.ts` | LLM prompt templates with `FieldInfo` type (name, type, description) |
| `types.ts` | `FieldMapping` (selector + transform) and `FieldMappings` types |
| `exceptions.ts` | `ExtractionFailed` and `PermanentFailure` error classes |
| `index.ts` | Public exports: `Scraper`, `ScraperConfig`, exceptions |

### Selector Value Extraction Logic

`runSelectors` in `selector.ts` first extracts a raw string value using element-type heuristics, then applies the LLM-generated `transform` expression (via `new Function`) to produce the final typed value.

Raw value extraction per element type:
- `input/textarea/select` → `value` attribute
- `img` → `alt` attribute
- `a` → `href` attribute
- Elements with `aria-label` → `aria-label` attribute
- Default → `.text().trim()`

After extraction, the transform expression receives the raw string as `value` and returns the correctly typed result (e.g., `parseFloat(value.replace(/[^0-9.-]/g, ''))` for numbers).

### Schema Hashing

The cache key uses SHA256 of sorted field names + Zod type names (sliced to 16 chars). This is stable and avoids Zod internals.

## Key Design Decisions

- **Single healing attempt**: One LLM retry per scrape call to avoid token waste
- **Permanent failure guard**: Checked at the start of `scrape()` before fetching — saves page load + LLM call after 4+ consecutive failures
- **`LanguageModel` interface**: Accepts any Vercel AI SDK `LanguageModel` directly (Anthropic, OpenAI, Google, etc.)
- **Cache location**: `.healscrape/cache.db` in `process.cwd()` by default, configurable via `ScraperConfig.cachePath`
- **`FieldMappings` with transforms**: Each field mapping is `{ selector, transform }` — the LLM generates both the CSS selector and a JS transform expression, replacing reliance on Zod coercion for type conversion
- **Dual format output**: tsup builds ESM (`dist/index.js`) + CJS (`dist/index.cjs`) + TypeScript declarations

## Tech Stack

- **TypeScript** (strict mode) with ES2022 target
- **Zod** for schema validation with coercion
- **Playwright** for browser-based page fetching
- **cheerio** for HTML parsing and selector execution
- **better-sqlite3** for embedded selector cache
- **Vercel AI SDK (`ai`)** for LLM abstraction
- **vitest** for testing (globals enabled — no imports needed for `describe`/`it`/`expect`)
- **tsup** for bundling

## Testing

Tests are in `src/__tests__/`. All LLM and Playwright interactions are mocked. The test suite covers each module independently plus full orchestration in `scraper.test.ts`. Vitest globals are enabled so test helpers don't need explicit imports.
