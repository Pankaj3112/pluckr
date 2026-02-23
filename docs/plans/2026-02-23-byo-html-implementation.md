# BYO HTML Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the built-in playwright-ghost fetcher so users pass raw HTML directly, making healscrape a pure schema-first extraction library.

**Architecture:** Replace `url` with `html` + optional `cacheKey` in `ScrapeOptions`. Rename `fetcher.ts` to `cleaner.ts` (keeping only `cleanHtml`). Skip all cache operations when `cacheKey` is omitted. Remove `playwright` and `playwright-ghost` dependencies.

**Tech Stack:** TypeScript, Zod, cheerio, better-sqlite3, Vercel AI SDK, vitest

---

### Task 1: Rename `fetcher.ts` to `cleaner.ts` and remove `fetchAndClean`

**Files:**
- Delete: `src/fetcher.ts`
- Create: `src/cleaner.ts`

**Step 1: Create `src/cleaner.ts` with only the cleaning code**

```ts
import * as cheerio from 'cheerio'

const REMOVE_TAGS = ['script', 'style', 'svg', 'noscript', 'iframe']
const HIDDEN_CLASSES = ['hidden', 'd-none', 'sr-only']
const ALLOWED_ATTRS = new Set([
  'id', 'class', 'aria-label', 'placeholder', 'alt', 'href', 'src', 'value',
])

function isAllowedAttr(name: string): boolean {
  return ALLOWED_ATTRS.has(name) || name.startsWith('data-')
}

export function cleanHtml(html: string): string {
  const $ = cheerio.load(html)

  // Remove unwanted tags entirely
  $(REMOVE_TAGS.join(',')).remove()

  // Remove elements hidden via inline style
  $('[style]').each((_, el) => {
    const style = $(el).attr('style') ?? ''
    if (/display\s*:\s*none/i.test(style) || /visibility\s*:\s*hidden/i.test(style)) {
      $(el).remove()
    }
  })

  // Remove elements with hidden classes
  for (const cls of HIDDEN_CLASSES) {
    $(`.${cls}`).remove()
  }

  // Strip disallowed attributes from all elements
  $('*').each((_, el) => {
    const attribs = $(el).attr()
    if (attribs) {
      for (const name of Object.keys(attribs)) {
        if (!isAllowedAttr(name)) {
          $(el).removeAttr(name)
        }
      }
    }
  })

  return $.html()
}
```

**Step 2: Delete `src/fetcher.ts`**

```bash
rm src/fetcher.ts
```

**Step 3: Update `src/__tests__/fetcher.test.ts` → rename to `src/__tests__/cleaner.test.ts`**

Change the import on line 2 from:
```ts
import { cleanHtml } from '../fetcher.js'
```
to:
```ts
import { cleanHtml } from '../cleaner.js'
```

```bash
mv src/__tests__/fetcher.test.ts src/__tests__/cleaner.test.ts
```

**Step 4: Run tests to verify cleaning tests still pass**

Run: `npx vitest run src/__tests__/cleaner.test.ts`
Expected: All 6 tests PASS

**Step 5: Commit**

```bash
git add src/cleaner.ts src/__tests__/cleaner.test.ts
git rm src/fetcher.ts src/__tests__/fetcher.test.ts
git commit -m "refactor: rename fetcher.ts to cleaner.ts, remove fetchAndClean"
```

---

### Task 2: Remove `FETCH_FAILED` from `ScrapeError` type

**Files:**
- Modify: `src/types.ts:9`

**Step 1: Update the `ScrapeError` code union**

In `src/types.ts`, change line 10 from:
```ts
  code: 'NO_DATA' | 'EXTRACTION_FAILED' | 'FETCH_FAILED' | 'PERMANENT_FAILURE'
```
to:
```ts
  code: 'NO_DATA' | 'EXTRACTION_FAILED' | 'PERMANENT_FAILURE'
```

**Step 2: Run type tests to verify**

Run: `npx vitest run src/__tests__/types.test.ts`
Expected: All 3 tests PASS (none reference `FETCH_FAILED`)

**Step 3: Commit**

```bash
git add src/types.ts
git commit -m "refactor: remove FETCH_FAILED from ScrapeError code union"
```

---

### Task 3: Update `ScrapeOptions` and `scraper.ts` to accept `html` + `cacheKey`

**Files:**
- Modify: `src/scraper.ts`

**Step 1: Write failing test — scraper accepts html instead of url**

Add to `src/__tests__/scraper.test.ts`. First, update the mocks and imports at the top of the file. Replace the entire file with:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { LanguageModel } from 'ai'
import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { FieldMappings } from '../types.js'

vi.mock('../llm.js', () => ({
  extractWithTools: vi.fn(),
}))

import { extractWithTools } from '../llm.js'
import { Scraper } from '../scraper.js'

const mockExtract = vi.mocked(extractWithTools)

const fakeModel = { modelId: 'test-model' } as LanguageModel

const PRODUCT_HTML = `<html><body>
  <h1>Widget</h1>
  <span class="price">$29.99</span>
  <span id="stock">In Stock</span>
</body></html>`

const schema = z.object({
  title: z.string(),
  price: z.number().positive(),
  inStock: z.boolean(),
})

const goodMappings: FieldMappings = {
  title: { selector: 'h1', transform: 'value.trim()' },
  price: { selector: '.price', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
  inStock: { selector: '#stock', transform: "value.toLowerCase().includes('in stock')" },
}

describe('Scraper', () => {
  let scraper: Scraper
  let tmpDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healscrape-test-'))
    scraper = new Scraper({
      model: fakeModel,
      cachePath: path.join(tmpDir, 'cache.db'),
    })
  })

  afterEach(() => {
    scraper.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns success result when extraction succeeds', async () => {
    mockExtract.mockResolvedValueOnce({
      success: true,
      data: { title: 'Widget', price: 29.99, inStock: true },
      fieldMappings: goodMappings,
    })

    const result = await scraper.scrape({ html: PRODUCT_HTML, schema, cacheKey: 'test-product' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ title: 'Widget', price: 29.99, inStock: true })
    }
  })

  it('uses cached field mappings on second call (no LLM)', async () => {
    mockExtract.mockResolvedValueOnce({
      success: true,
      data: { title: 'Widget', price: 29.99, inStock: true },
      fieldMappings: goodMappings,
    })

    await scraper.scrape({ html: PRODUCT_HTML, schema, cacheKey: 'test-product' })
    const result = await scraper.scrape({ html: PRODUCT_HTML, schema, cacheKey: 'test-product' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ title: 'Widget', price: 29.99, inStock: true })
    }
    // extractWithTools should only be called once — second call uses cache
    expect(mockExtract).toHaveBeenCalledOnce()
  })

  it('skips caching entirely when no cacheKey provided', async () => {
    mockExtract.mockResolvedValue({
      success: true,
      data: { title: 'Widget', price: 29.99, inStock: true },
      fieldMappings: goodMappings,
    })

    await scraper.scrape({ html: PRODUCT_HTML, schema })
    await scraper.scrape({ html: PRODUCT_HTML, schema })

    // Without cacheKey, extractWithTools is called every time (no cache)
    expect(mockExtract).toHaveBeenCalledTimes(2)
  })

  it('returns NO_DATA error when AI reports no data', async () => {
    mockExtract.mockResolvedValueOnce({
      success: false,
      error: { code: 'NO_DATA', message: 'Page is a login form' },
    })

    const result = await scraper.scrape({ html: PRODUCT_HTML, schema, cacheKey: 'test-product' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('NO_DATA')
    }
  })

  it('returns EXTRACTION_FAILED when tool loop exhausts', async () => {
    mockExtract.mockResolvedValueOnce({
      success: false,
      error: { code: 'EXTRACTION_FAILED', message: 'Could not extract' },
    })

    const result = await scraper.scrape({ html: PRODUCT_HTML, schema, cacheKey: 'test-product' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('EXTRACTION_FAILED')
    }
  })

  it('returns PERMANENT_FAILURE after too many consecutive failures', async () => {
    mockExtract.mockResolvedValue({
      success: false,
      error: { code: 'EXTRACTION_FAILED', message: 'Failed' },
    })

    // Exhaust consecutive failure count
    for (let i = 0; i < 4; i++) {
      await scraper.scrape({ html: PRODUCT_HTML, schema, cacheKey: 'test-product' })
    }

    const result = await scraper.scrape({ html: PRODUCT_HTML, schema, cacheKey: 'test-product' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('PERMANENT_FAILURE')
    }
    // Should NOT have called extract on the 5th attempt
    expect(mockExtract).toHaveBeenCalledTimes(4)
  })

  it('does not track permanent failures when no cacheKey', async () => {
    mockExtract.mockResolvedValue({
      success: false,
      error: { code: 'EXTRACTION_FAILED', message: 'Failed' },
    })

    // Without cacheKey, failures aren't tracked, so no PERMANENT_FAILURE
    for (let i = 0; i < 5; i++) {
      const result = await scraper.scrape({ html: PRODUCT_HTML, schema })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('EXTRACTION_FAILED')
      }
    }

    // All 5 calls went through to extractWithTools (no permanent failure short-circuit)
    expect(mockExtract).toHaveBeenCalledTimes(5)
  })

  it('re-runs tool loop with cached hint when cache hit fails validation', async () => {
    // First call: succeeds and caches
    mockExtract.mockResolvedValueOnce({
      success: true,
      data: { title: 'Widget', price: 29.99, inStock: true },
      fieldMappings: goodMappings,
    })
    await scraper.scrape({ html: PRODUCT_HTML, schema, cacheKey: 'test-product' })

    // Simulate page change — cached selectors fail, need tool loop with hint
    const changedHtml = '<html><body><h2>Widget v2</h2><div class="new-price">$39.99</div></body></html>'
    mockExtract.mockResolvedValueOnce({
      success: true,
      data: { title: 'Widget v2', price: 39.99, inStock: true },
      fieldMappings: {
        title: { selector: 'h2', transform: 'value.trim()' },
        price: { selector: '.new-price', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
        inStock: { selector: '#stock', transform: "value.toLowerCase().includes('in stock')" },
      },
    })

    const result = await scraper.scrape({ html: changedHtml, schema, cacheKey: 'test-product' })

    // extractWithTools should have been called with cachedMappings
    expect(mockExtract).toHaveBeenCalledTimes(2)
    const secondCallArgs = mockExtract.mock.calls[1][0] as any
    expect(secondCallArgs.cachedMappings).toBeDefined()
  })

  it('passes maxToolCallsPerField * fieldCount as maxToolCalls', async () => {
    const customScraper = new Scraper({
      model: fakeModel,
      cachePath: path.join(tmpDir, 'cache2.db'),
      maxToolCallsPerField: 5,
    })

    mockExtract.mockResolvedValueOnce({
      success: true,
      data: { title: 'Widget', price: 29.99, inStock: true },
      fieldMappings: goodMappings,
    })

    await customScraper.scrape({ html: PRODUCT_HTML, schema, cacheKey: 'test-product' })

    const callArgs = mockExtract.mock.calls[0][0] as any
    // schema has 3 fields (title, price, inStock), so 5 * 3 = 15
    expect(callArgs.maxToolCalls).toBe(15)

    customScraper.close()
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/scraper.test.ts`
Expected: FAIL — `ScrapeOptions` still expects `url`, not `html`

**Step 3: Update `src/scraper.ts`**

Replace the entire file with:

```ts
import crypto from 'node:crypto'
import { type LanguageModel } from 'ai'
import { type ZodObject, type ZodRawShape } from 'zod'
import type { FieldMappings, ScrapeResult } from './types.js'
import { type FieldInfo } from './prompts.js'
import { SelectorCache } from './cache.js'
import { cleanHtml } from './cleaner.js'
import { extractWithTools } from './llm.js'
import { runSelectors } from './selector.js'
import { validate } from './validator.js'

const MAX_CONSECUTIVE_FAILURES = 3
const DEFAULT_MAX_TOOL_CALLS_PER_FIELD = 3

export interface ScraperConfig {
  model: LanguageModel
  cachePath?: string
  debug?: boolean
  maxToolCallsPerField?: number
}

interface ScrapeOptions<T extends ZodRawShape> {
  html: string
  schema: ZodObject<T>
  cacheKey?: string
}

function extractFieldInfo(schema: ZodObject<ZodRawShape>): FieldInfo[] {
  return Object.entries(schema.shape).map(([name, field]) => {
    let current = field as any
    while (current._def?.innerType) {
      current = current._def.innerType
    }
    return {
      name,
      type: current.constructor.name,
      description: (field as any).description,
    }
  })
}

function computeSchemaHash(schema: ZodObject<ZodRawShape>): string {
  const fields: Record<string, { type: string; description?: string }> = {}
  for (const [key, value] of Object.entries(schema.shape)) {
    let current = value as any
    while (current._def?.innerType) {
      current = current._def.innerType
    }
    fields[key] = {
      type: current.constructor.name,
      description: (value as any).description,
    }
  }
  const sorted: Record<string, { type: string; description?: string }> = {}
  for (const key of Object.keys(fields).sort()) {
    sorted[key] = fields[key]
  }
  const content = JSON.stringify(sorted)
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
}

export class Scraper {
  private cache: SelectorCache
  private model: LanguageModel
  private debug: boolean
  private maxToolCallsPerField: number

  constructor(config: ScraperConfig) {
    this.cache = new SelectorCache(config.cachePath)
    this.model = config.model
    this.debug = config.debug ?? false
    this.maxToolCallsPerField = config.maxToolCallsPerField ?? DEFAULT_MAX_TOOL_CALLS_PER_FIELD
  }

  async scrape<T extends ZodRawShape>(
    options: ScrapeOptions<T>,
  ): Promise<ScrapeResult<ReturnType<ZodObject<T>['parse']>>> {
    const { html, schema, cacheKey } = options
    const schemaHash = computeSchemaHash(schema as unknown as ZodObject<ZodRawShape>)
    const cleanedHtml = cleanHtml(html)

    // Guard: check for permanent failure (only when caching is enabled)
    if (cacheKey) {
      const failureCount = this.cache.getFailureCount(cacheKey, schemaHash)
      if (failureCount > MAX_CONSECUTIVE_FAILURES) {
        return {
          success: false,
          error: {
            code: 'PERMANENT_FAILURE',
            message: `Scraping has failed ${failureCount} consecutive times for cache key "${cacheKey}". Clear the cache to retry.`,
          },
        }
      }
    }

    // Check cache for field mappings (only when caching is enabled)
    const cachedMappings = cacheKey ? this.cache.get(cacheKey, schemaHash) : null

    // If cached, try running them directly first
    if (cachedMappings) {
      const rawData = runSelectors(cleanedHtml, cachedMappings)
      const result = validate(schema, rawData)

      if (result.success) {
        if (this.debug) {
          console.log('[debug] Cache hit — validated successfully')
        }
        return { success: true, data: result.data }
      }

      if (this.debug) {
        console.log('[debug] Cache hit but validation failed, running tool loop with hint')
      }
    }

    // Run tool-based extraction
    const fieldInfos = extractFieldInfo(schema as unknown as ZodObject<ZodRawShape>)
    const extractionResult = await extractWithTools({
      html: cleanedHtml,
      fields: fieldInfos,
      schema: schema as unknown as ZodObject<ZodRawShape>,
      model: this.model,
      maxToolCalls: this.maxToolCallsPerField * fieldInfos.length,
      cachedMappings: cachedMappings ?? undefined,
      debug: this.debug,
    })

    if (extractionResult.success) {
      if (cacheKey) {
        this.cache.set(cacheKey, schemaHash, extractionResult.fieldMappings)
        this.cache.resetFailures(cacheKey, schemaHash)
      }
      return { success: true, data: extractionResult.data as ReturnType<ZodObject<T>['parse']> }
    }

    // Track failures for EXTRACTION_FAILED (only when caching is enabled)
    if (cacheKey && extractionResult.error.code === 'EXTRACTION_FAILED') {
      this.cache.incrementFailures(cacheKey, schemaHash)
    }

    return extractionResult
  }

  close(): void {
    this.cache.close()
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/scraper.test.ts`
Expected: All 9 tests PASS

**Step 5: Commit**

```bash
git add src/scraper.ts src/__tests__/scraper.test.ts
git commit -m "feat: accept raw HTML + optional cacheKey instead of URL"
```

---

### Task 4: Update `index.ts` exports

**Files:**
- Modify: `src/index.ts`

**Step 1: Update exports to use cleaner.ts and add cleanHtml**

Replace `src/index.ts` with:

```ts
export { Scraper, type ScraperConfig } from './scraper.js'
export { cleanHtml } from './cleaner.js'
export { ExtractionFailed, PermanentFailure } from './exceptions.js'
export type { FieldMapping, FieldMappings, ScrapeResult, ScrapeError } from './types.js'
```

**Step 2: Run all tests to verify nothing is broken**

Run: `npx vitest run`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: export cleanHtml utility from index"
```

---

### Task 5: Remove playwright dependencies from `package.json`

**Files:**
- Modify: `package.json`

**Step 1: Remove playwright and playwright-ghost from dependencies**

In `package.json`, remove these two lines from `"dependencies"`:
```json
    "playwright": "^1",
    "playwright-ghost": "^0.17.0",
```

So `dependencies` becomes:
```json
  "dependencies": {
    "ai": "^6",
    "better-sqlite3": "^11",
    "cheerio": "^1",
    "zod": "^3"
  },
```

**Step 2: Run npm install to update lockfile**

Run: `npm install`
Expected: Completes successfully, lockfile updated

**Step 3: Run all tests to verify everything still works**

Run: `npx vitest run`
Expected: All tests PASS

**Step 4: Build to verify compilation**

Run: `npm run build`
Expected: Builds successfully

**Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: remove playwright and playwright-ghost dependencies"
```

---

### Task 6: Update `CLAUDE.md` documentation

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update CLAUDE.md to reflect new architecture**

Key changes:
- Project overview: "schema-first, self-healing web scraping" → "schema-first, self-healing HTML data extraction"
- Remove the `npx playwright install chromium` command
- Update the architecture diagram: remove fetch step, show `html` input
- Rename `fetcher.ts` → `cleaner.ts` in the module table, update its description
- Remove "Stealth fetching" from design decisions
- Add "BYO HTML" design decision
- Remove `playwright-ghost` from tech stack
- Update testing section (no more Playwright mocks)

Replace the full `CLAUDE.md` with:

```markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**healscrape** is a TypeScript library for schema-first, self-healing HTML data extraction powered by LLMs. Users provide HTML and a Zod schema, the library uses an agentic LLM tool loop to generate and verify CSS selectors, extracts and validates data, caches working selectors in SQLite, and automatically heals broken selectors when page structures change.

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
Scraper.scrape({ html, schema, cacheKey? }) → ScrapeResult<T>
  ├─ cleanHtml: cheerio strips scripts, styles, hidden elements, irrelevant attrs
  ├─ cacheKey provided? → SelectorCache: check for cached field mappings (SQLite)
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
| `scraper.ts` | Main orchestration class, public API, returns `ScrapeResult<T>` |
| `cache.ts` | SQLite selector cache with failure tracking |
| `cleaner.ts` | cheerio-based HTML cleaning (strips noise for LLM token efficiency) |
| `selector.ts` | CSS selector execution + JS transform application + `testSingleSelector` helper |
| `llm.ts` | Vercel AI SDK wrapper: `extractWithTools` using `generateText` + tools |
| `validator.ts` | Zod validation wrapper with error formatting |
| `prompts.ts` | LLM prompt templates: `EXTRACTION_SYSTEM_PROMPT`, `buildExtractionPrompt`, `buildCachedHintPrompt` |
| `types.ts` | `FieldMapping`, `FieldMappings`, `ScrapeResult`, `ScrapeError` types |
| `exceptions.ts` | `ExtractionFailed` and `PermanentFailure` error classes (legacy, kept for compat) |
| `index.ts` | Public exports: `Scraper`, `ScraperConfig`, `cleanHtml`, types, exceptions |

### Selector Value Extraction Logic

`runSelectors` in `selector.ts` extracts a raw string value, then applies the LLM-generated `transform` expression (via `new Function`) to produce the final typed value.

Raw value extraction: if `attribute` is specified, uses that attribute; otherwise extracts `.text().trim()`.

`testSingleSelector` provides the same logic for a single field, returning structured success/error results for the LLM tool loop.

### Schema Hashing

The cache key uses SHA256 of sorted field names + Zod type names + descriptions (sliced to 16 chars). This is stable and avoids Zod internals.

## Key Design Decisions

- **BYO HTML**: Users provide raw HTML; healscrape does not fetch pages. This keeps the library lightweight (no browser deps) and lets users handle fetching with their own tools (Puppeteer, Playwright, proxies, curl, etc.)
- **Optional caching via `cacheKey`**: When `cacheKey` is provided, selectors are cached in SQLite. When omitted, every call runs the full LLM extraction (useful for one-off extractions)
- **Tool-based extraction**: LLM uses `generateText` + tools (`testSelector`, `submitResult`, `reportNoData`) to iteratively verify selectors before committing, replacing blind `generateObject`
- **Self-healing inside tool loop**: No separate heal step — the AI self-corrects within the same `generateText` call when `submitResult` reports validation errors
- **Discriminated union return**: `scrape()` returns `ScrapeResult<T>` (`{ success: true, data }` | `{ success: false, error }`) instead of throwing exceptions
- **Configurable tool calls**: `maxToolCalls` in `ScraperConfig` controls the `stopWhen` limit (default: 3)
- **Permanent failure guard**: Checked at the start of `scrape()` before LLM call after 4+ consecutive failures (only with `cacheKey`)
- **`LanguageModel` interface**: Accepts any Vercel AI SDK `LanguageModel` directly (Anthropic, OpenAI, Google, etc.)
- **Cache location**: `.healscrape/cache.db` in `process.cwd()` by default, configurable via `ScraperConfig.cachePath`
- **Cache-first with hint**: On cache hit, runs cached selectors first; if validation fails, passes them as hints to the tool loop
- **Dual format output**: tsup builds ESM (`dist/index.js`) + CJS (`dist/index.cjs`) + TypeScript declarations

## Tech Stack

- **TypeScript** (strict mode) with ES2022 target
- **Zod** for schema validation with coercion
- **cheerio** for HTML parsing, cleaning, and selector execution
- **better-sqlite3** for embedded selector cache
- **Vercel AI SDK (`ai` v6)** for LLM abstraction with tool calling (`generateText`, `tool`, `stepCountIs`)
- **vitest** for testing (globals enabled — no imports needed for `describe`/`it`/`expect`)
- **tsup** for bundling

## Testing

Tests are in `src/__tests__/`. All LLM interactions are mocked. The test suite covers each module independently plus full orchestration in `scraper.test.ts`. Vitest globals are enabled so test helpers don't need explicit imports.
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for BYO HTML architecture"
```

---

### Task 7: Final verification

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

**Step 2: Run build**

Run: `npm run build`
Expected: Clean build, no errors

**Step 3: Verify no references to old fetcher remain**

Run: `grep -r "fetchAndClean\|playwright-ghost\|FETCH_FAILED" src/`
Expected: No matches

---

Plan complete and saved to `docs/plans/2026-02-23-byo-html-implementation.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?

<function_calls>
<invoke name="AskUserQuestion">
<parameter name="questions">[{"question": "How do you want to execute this plan?", "header": "Execution", "options": [{"label": "Subagent-Driven (Recommended)", "description": "I dispatch fresh subagent per task in this session, review between tasks, fast iteration."}, {"label": "Parallel Session", "description": "Open a new session with executing-plans skill, batch execution with checkpoints."}], "multiSelect": false}]