# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**healscrape** is a TypeScript library for schema-first, self-healing web scraping powered by LLMs. Users define a Zod schema, the library uses an agentic LLM tool loop to generate and verify CSS selectors, extracts and validates data, caches working selectors in SQLite, and automatically heals broken selectors when pages change.

## Commands

```bash
npm run build          # Build ESM + CJS + type declarations to dist/
npm test               # Run all tests (vitest)
npm run test:watch     # Run tests in watch mode
npx vitest run src/__tests__/cache.test.ts   # Run a single test file
npx playwright install chromium              # Required for Playwright (first-time setup)
```

## Architecture

The scrape pipeline flows: **fetch (stealth) → clean → tool-based LLM extraction loop → validate → cache (or return error)**

```
Scraper.scrape(url, schema) → ScrapeResult<T>
  ├─ SelectorCache: check for cached field mappings (SQLite)
  ├─ fetchAndClean: playwright-ghost (stealth) fetches page, cheerio strips noise
  ├─ Cache hit? → runSelectors + validate → if valid, return success
  ├─ extractWithTools: agentic LLM loop with tools:
  │   ├─ testSelector: AI tests individual CSS selectors against HTML
  │   ├─ submitResult: AI submits all field mappings, system validates via Zod
  │   └─ reportNoData: AI reports page doesn't contain requested data
  ├─ Success → cache field mappings, return { success: true, data }
  └─ Failure → return { success: false, error: { code, message } }
      └─ After 4+ consecutive failures → PERMANENT_FAILURE (skips fetch/LLM)
```

### Key Modules (all in `src/`)

| Module | Role |
|--------|------|
| `scraper.ts` | Main orchestration class, public API, returns `ScrapeResult<T>` |
| `cache.ts` | SQLite selector cache with failure tracking |
| `fetcher.ts` | playwright-ghost stealth page fetch + cheerio HTML cleaning |
| `selector.ts` | CSS selector execution + JS transform application + `testSingleSelector` helper |
| `llm.ts` | Vercel AI SDK wrapper: `extractWithTools` using `generateText` + tools |
| `validator.ts` | Zod validation wrapper with error formatting |
| `prompts.ts` | LLM prompt templates: `EXTRACTION_SYSTEM_PROMPT`, `buildExtractionPrompt`, `buildCachedHintPrompt` |
| `types.ts` | `FieldMapping`, `FieldMappings`, `ScrapeResult`, `ScrapeError` types |
| `exceptions.ts` | `ExtractionFailed` and `PermanentFailure` error classes (legacy, kept for compat) |
| `index.ts` | Public exports: `Scraper`, `ScraperConfig`, types, exceptions |

### Selector Value Extraction Logic

`runSelectors` in `selector.ts` extracts a raw string value, then applies the LLM-generated `transform` expression (via `new Function`) to produce the final typed value.

Raw value extraction: if `attribute` is specified, uses that attribute; otherwise extracts `.text().trim()`.

`testSingleSelector` provides the same logic for a single field, returning structured success/error results for the LLM tool loop.

### Schema Hashing

The cache key uses SHA256 of sorted field names + Zod type names + descriptions (sliced to 16 chars). This is stable and avoids Zod internals.

## Key Design Decisions

- **Tool-based extraction**: LLM uses `generateText` + tools (`testSelector`, `submitResult`, `reportNoData`) to iteratively verify selectors before committing, replacing blind `generateObject`
- **Self-healing inside tool loop**: No separate heal step — the AI self-corrects within the same `generateText` call when `submitResult` reports validation errors
- **Discriminated union return**: `scrape()` returns `ScrapeResult<T>` (`{ success: true, data }` | `{ success: false, error }`) instead of throwing exceptions
- **Configurable tool calls**: `maxToolCalls` in `ScraperConfig` controls the `stopWhen` limit (default: 3)
- **Stealth fetching**: `playwright-ghost` with `plugins.recommended()` for anti-bot evasion (passes 24+ detection tests)
- **Permanent failure guard**: Checked at the start of `scrape()` before fetching — saves page load + LLM call after 4+ consecutive failures
- **`LanguageModel` interface**: Accepts any Vercel AI SDK `LanguageModel` directly (Anthropic, OpenAI, Google, etc.)
- **Cache location**: `.healscrape/cache.db` in `process.cwd()` by default, configurable via `ScraperConfig.cachePath`
- **Cache-first with hint**: On cache hit, runs cached selectors first; if validation fails, passes them as hints to the tool loop
- **Dual format output**: tsup builds ESM (`dist/index.js`) + CJS (`dist/index.cjs`) + TypeScript declarations

## Tech Stack

- **TypeScript** (strict mode) with ES2022 target
- **Zod** for schema validation with coercion
- **playwright-ghost** for stealth browser-based page fetching
- **cheerio** for HTML parsing and selector execution
- **better-sqlite3** for embedded selector cache
- **Vercel AI SDK (`ai` v6)** for LLM abstraction with tool calling (`generateText`, `tool`, `stepCountIs`)
- **vitest** for testing (globals enabled — no imports needed for `describe`/`it`/`expect`)
- **tsup** for bundling

## Testing

Tests are in `src/__tests__/`. All LLM and Playwright interactions are mocked. The test suite covers each module independently plus full orchestration in `scraper.test.ts`. Vitest globals are enabled so test helpers don't need explicit imports.
