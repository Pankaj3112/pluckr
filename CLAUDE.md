# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**@pluckr/core** is a TypeScript library for schema-first, self-healing HTML data extraction powered by LLMs. Users provide HTML and a Zod schema, the library uses an agentic LLM tool loop to generate and verify CSS selectors, extracts and validates data, caches working selectors, and automatically heals broken selectors when page structures change.

## Commands

```bash
npm run build          # Build ESM + CJS + type declarations to dist/
npm test               # Run all tests (vitest)
npm run test:watch     # Run tests in watch mode
npx vitest run src/__tests__/cache.test.ts   # Run a single test file
```

## Architecture

The extraction pipeline flows: **clean → cache check → tool-based LLM extraction loop → validate → cache (or return error)**

```
Pluckr.extract({ html, schema, cacheKey? }) → ExtractResult<T>
  ├─ cleanHtml: cheerio strips scripts, styles, hidden elements, irrelevant attrs
  ├─ cacheKey provided? → Storage: check for cached field mappings
  ├─ Cache hit? → runSelectors + validate → if valid, return success
  ├─ extractWithTools: agentic LLM loop with tools:
  │   ├─ testSelector: AI tests individual CSS selectors against HTML
  │   ├─ submitResult: AI submits all field mappings, system validates via Zod
  │   └─ reportNoData: AI reports page doesn't contain requested data
  ├─ Success → cache field mappings (if cacheKey), return { success: true, data }
  └─ Failure → return { success: false, error: { code, message } }
      └─ After 4+ consecutive failures (with cacheKey) → PERMANENT_FAILURE
```

### Key Modules (all in `src/`)

| Module | Role |
|--------|------|
| `scraper.ts` | Main `Pluckr` class, public API, returns `ExtractResult<T>` |
| `types.ts` | `FieldMapping`, `FieldMappings`, `ExtractResult`, `ExtractError` types |
| `index.ts` | Public exports: `Pluckr`, `PluckrConfig`, `ExtractOptions`, `cleanHtml`, types |
| `cleaner.ts` | cheerio-based HTML cleaning (strips noise for LLM token efficiency) |
| `selector.ts` | CSS selector execution + JS transform application + `testSingleSelector` helper |
| `llm.ts` | Vercel AI SDK wrapper: `extractWithTools` using `generateText` + tools |
| `validator.ts` | Zod validation wrapper with error formatting |
| `prompts.ts` | LLM prompt templates: `EXTRACTION_SYSTEM_PROMPT`, `buildExtractionPrompt`, `buildCachedHintPrompt` |
| `memory-storage.ts` | In-memory `Storage` implementation (default) |

### Selector Value Extraction Logic

`runSelectors` in `selector.ts` extracts a raw string value, then applies the LLM-generated `transform` expression (via `new Function`) to produce the final typed value.

Raw value extraction: if `attribute` is specified, uses that attribute; otherwise extracts `.text().trim()`.

`testSingleSelector` provides the same logic for a single field, returning structured success/error results for the LLM tool loop.

### Schema Hashing

The cache key uses SHA256 of sorted field names + Zod type names + descriptions (sliced to 16 chars). This is stable and avoids Zod internals.

## Key Design Decisions

- **BYO HTML**: Users provide raw HTML; Pluckr does not fetch pages. This keeps the library lightweight (no browser deps) and lets users handle fetching with their own tools (Puppeteer, Playwright, proxies, curl, etc.)
- **Optional caching via `cacheKey`**: When `cacheKey` is provided, selectors are cached via Storage. When omitted, every call runs the full LLM extraction (useful for one-off extractions)
- **Tool-based extraction**: LLM uses `generateText` + tools (`testSelector`, `submitResult`, `reportNoData`) to iteratively verify selectors before committing, replacing blind `generateObject`
- **Self-healing inside tool loop**: No separate heal step — the AI self-corrects within the same `generateText` call when `submitResult` reports validation errors
- **Discriminated union return**: `extract()` returns `ExtractResult<T>` (`{ success: true, data }` | `{ success: false, error }`) instead of throwing exceptions
- **Configurable tool calls**: `maxToolCallsPerField` in `PluckrConfig` controls the tool call limit (default: 3 per field)
- **Permanent failure guard**: Checked at the start of `extract()` before LLM call after 4+ consecutive failures (only with `cacheKey`)
- **`LanguageModel` interface**: Accepts any Vercel AI SDK `LanguageModel` directly (Anthropic, OpenAI, Google, etc.)
- **Cache location**: `.pluckr/cache.db` in `process.cwd()` by default (via `@pluckr/sqlite`), configurable via constructor path
- **Cache-first with hint**: On cache hit, runs cached selectors first; if validation fails, passes them as hints to the tool loop
- **Dual format output**: tsup builds ESM (`dist/index.js`) + CJS (`dist/index.cjs`) + TypeScript declarations

## Package Structure

- **`@pluckr/core`** — main extraction library (this package)
- **`@pluckr/sqlite`** — SQLite storage backend (in `packages/sqlite/`)

## Tech Stack

- **TypeScript** (strict mode) with ES2022 target
- **Zod** for schema validation with coercion
- **cheerio** for HTML parsing, cleaning, and selector execution
- **Vercel AI SDK (`ai` v6)** for LLM abstraction with tool calling (`generateText`, `tool`, `stepCountIs`)
- **vitest** for testing (globals enabled — no imports needed for `describe`/`it`/`expect`)
- **tsup** for bundling

## Testing

Tests are in `src/__tests__/`. All LLM interactions are mocked. The test suite covers each module independently plus full orchestration in `scraper.test.ts`. Vitest globals are enabled so test helpers don't need explicit imports.
