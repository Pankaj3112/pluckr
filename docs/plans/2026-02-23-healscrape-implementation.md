# healscrape Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a TypeScript library that scrapes web pages using LLM-generated CSS selectors, validated by Zod schemas, with SQLite-cached selectors for self-healing.

**Architecture:** A `Scraper` class orchestrates: Playwright fetches pages, cheerio cleans HTML and runs selectors, Vercel AI SDK asks an LLM to generate/fix selectors, Zod validates output, better-sqlite3 caches working selectors. Single healing retry on validation failure.

**Tech Stack:** TypeScript, Zod, Playwright, cheerio, better-sqlite3, Vercel AI SDK (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`), vitest, tsup

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Create: `vitest.config.ts`
- Create: `src/index.ts` (empty placeholder)

**Step 1: Create package.json**

```json
{
  "name": "healscrape",
  "version": "0.1.0",
  "description": "Schema-first, self-healing web scraping with LLM-generated selectors",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest"
  },
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
    "@types/node": "^22",
    "tsup": "^8",
    "vitest": "^3"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create tsup.config.ts**

```typescript
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
})
```

**Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
  },
})
```

**Step 5: Create placeholder src/index.ts**

```typescript
// healscrape - public exports
```

**Step 6: Install dependencies**

Run: `npm install`
Expected: Successful install, node_modules created

**Step 7: Verify build works**

Run: `npx tsup`
Expected: Build succeeds, dist/ created with index.js, index.cjs, index.d.ts

**Step 8: Verify test runner works**

Run: `npx vitest run`
Expected: "No test files found" (no tests yet, but vitest itself runs)

**Step 9: Commit**

```bash
git add package.json tsconfig.json tsup.config.ts vitest.config.ts src/index.ts package-lock.json
git commit -m "chore: scaffold project with TypeScript, tsup, vitest"
```

---

### Task 2: Custom Exceptions

**Files:**
- Create: `src/exceptions.ts`
- Create: `src/__tests__/exceptions.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/__tests__/exceptions.test.ts
import { describe, it, expect } from 'vitest'
import { ExtractionFailed, PermanentFailure } from '../exceptions.js'

describe('ExtractionFailed', () => {
  it('stores context and formats message', () => {
    const err = new ExtractionFailed({
      url: 'https://example.com',
      errors: 'price: Expected number, received NaN',
      rawData: { title: 'Widget', price: 'N/A' },
      selectors: { title: 'h1', price: '.price' },
    })

    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ExtractionFailed')
    expect(err.message).toContain('https://example.com')
    expect(err.message).toContain('price: Expected number, received NaN')
    expect(err.url).toBe('https://example.com')
    expect(err.errors).toBe('price: Expected number, received NaN')
    expect(err.rawData).toEqual({ title: 'Widget', price: 'N/A' })
    expect(err.selectors).toEqual({ title: 'h1', price: '.price' })
  })
})

describe('PermanentFailure', () => {
  it('stores context and formats message', () => {
    const err = new PermanentFailure({
      url: 'https://example.com',
      failureCount: 4,
    })

    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('PermanentFailure')
    expect(err.message).toContain('https://example.com')
    expect(err.message).toContain('4')
    expect(err.message).toContain('cache')
    expect(err.url).toBe('https://example.com')
    expect(err.failureCount).toBe(4)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/exceptions.test.ts`
Expected: FAIL — cannot find module '../exceptions.js'

**Step 3: Write implementation**

```typescript
// src/exceptions.ts

interface ExtractionFailedOptions {
  url: string
  errors: string
  rawData: unknown
  selectors: Record<string, string>
}

export class ExtractionFailed extends Error {
  readonly url: string
  readonly errors: string
  readonly rawData: unknown
  readonly selectors: Record<string, string>

  constructor({ url, errors, rawData, selectors }: ExtractionFailedOptions) {
    super(`Failed to extract data from ${url}: ${errors}`)
    this.name = 'ExtractionFailed'
    this.url = url
    this.errors = errors
    this.rawData = rawData
    this.selectors = selectors
  }
}

interface PermanentFailureOptions {
  url: string
  failureCount: number
}

export class PermanentFailure extends Error {
  readonly url: string
  readonly failureCount: number

  constructor({ url, failureCount }: PermanentFailureOptions) {
    super(
      `Scraping ${url} has failed ${failureCount} consecutive times. ` +
      `The site structure may have changed. Clear the cache to retry.`
    )
    this.name = 'PermanentFailure'
    this.url = url
    this.failureCount = failureCount
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/exceptions.test.ts`
Expected: 2 tests PASS

**Step 5: Commit**

```bash
git add src/exceptions.ts src/__tests__/exceptions.test.ts
git commit -m "feat: add ExtractionFailed and PermanentFailure error classes"
```

---

### Task 3: Validator

**Files:**
- Create: `src/validator.ts`
- Create: `src/__tests__/validator.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/__tests__/validator.test.ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { validate } from '../validator.js'

describe('validate', () => {
  const schema = z.object({
    title: z.string(),
    price: z.coerce.number().positive(),
    inStock: z.coerce.boolean(),
  })

  it('returns success with parsed data when valid', () => {
    const result = validate(schema, {
      title: 'Widget',
      price: '29.99',
      inStock: 'true',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({
        title: 'Widget',
        price: 29.99,
        inStock: true,
      })
    }
  })

  it('returns failure with formatted errors when invalid', () => {
    const result = validate(schema, {
      title: 'Widget',
      price: 'not-a-number',
      inStock: 'true',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors).toContain('price')
      expect(result.rawData).toEqual({
        title: 'Widget',
        price: 'not-a-number',
        inStock: 'true',
      })
    }
  })

  it('returns failure when required fields are null', () => {
    const result = validate(schema, {
      title: null,
      price: '10',
      inStock: 'true',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors).toContain('title')
    }
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/validator.test.ts`
Expected: FAIL — cannot find module '../validator.js'

**Step 3: Write implementation**

```typescript
// src/validator.ts
import { type ZodSchema, type ZodError } from 'zod'

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: string; rawData: unknown }

function formatZodErrors(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.')
      return `${path}: ${issue.message} (code: ${issue.code})`
    })
    .join('; ')
}

export function validate<T>(
  schema: ZodSchema<T>,
  data: unknown,
): ValidationResult<T> {
  const result = schema.safeParse(data)

  if (result.success) {
    return { success: true, data: result.data }
  }

  return {
    success: false,
    errors: formatZodErrors(result.error),
    rawData: data,
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/validator.test.ts`
Expected: 3 tests PASS

**Step 5: Commit**

```bash
git add src/validator.ts src/__tests__/validator.test.ts
git commit -m "feat: add Zod validation wrapper with error formatting"
```

---

### Task 4: SQLite Cache

**Files:**
- Create: `src/cache.ts`
- Create: `src/__tests__/cache.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/__tests__/cache.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SelectorCache } from '../cache.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('SelectorCache', () => {
  let cache: SelectorCache
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healscrape-test-'))
    cache = new SelectorCache(path.join(tmpDir, 'cache.db'))
  })

  afterEach(() => {
    cache.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns null for cache miss', () => {
    const result = cache.get('https://example.com', 'abc123')
    expect(result).toBeNull()
  })

  it('stores and retrieves selectors', () => {
    const selectors = { title: 'h1', price: '.price' }
    cache.set('https://example.com', 'abc123', selectors)

    const result = cache.get('https://example.com', 'abc123')
    expect(result).toEqual(selectors)
  })

  it('updates selectors on duplicate key', () => {
    cache.set('https://example.com', 'abc123', { title: 'h1' })
    cache.set('https://example.com', 'abc123', { title: 'h2.new' })

    const result = cache.get('https://example.com', 'abc123')
    expect(result).toEqual({ title: 'h2.new' })
  })

  it('tracks consecutive failures', () => {
    cache.set('https://example.com', 'abc123', { title: 'h1' })

    expect(cache.getFailureCount('https://example.com', 'abc123')).toBe(0)

    cache.incrementFailures('https://example.com', 'abc123')
    cache.incrementFailures('https://example.com', 'abc123')
    expect(cache.getFailureCount('https://example.com', 'abc123')).toBe(2)

    cache.resetFailures('https://example.com', 'abc123')
    expect(cache.getFailureCount('https://example.com', 'abc123')).toBe(0)
  })

  it('returns 0 failures for unknown entries', () => {
    expect(cache.getFailureCount('https://unknown.com', 'xyz')).toBe(0)
  })

  it('isolates entries by url and schema hash', () => {
    cache.set('https://a.com', 'hash1', { title: 'h1' })
    cache.set('https://b.com', 'hash1', { title: 'h2' })
    cache.set('https://a.com', 'hash2', { title: 'h3' })

    expect(cache.get('https://a.com', 'hash1')).toEqual({ title: 'h1' })
    expect(cache.get('https://b.com', 'hash1')).toEqual({ title: 'h2' })
    expect(cache.get('https://a.com', 'hash2')).toEqual({ title: 'h3' })
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/cache.test.ts`
Expected: FAIL — cannot find module '../cache.js'

**Step 3: Write implementation**

```typescript
// src/cache.ts
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

export class SelectorCache {
  private db: Database.Database

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? path.join(process.cwd(), '.healscrape', 'cache.db')
    const dir = path.dirname(resolvedPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    this.db = new Database(resolvedPath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS selector_cache (
        id INTEGER PRIMARY KEY,
        url TEXT NOT NULL,
        schema_hash TEXT NOT NULL,
        selectors TEXT NOT NULL,
        consecutive_failures INTEGER DEFAULT 0,
        last_success_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(url, schema_hash)
      )
    `)
  }

  get(url: string, schemaHash: string): Record<string, string> | null {
    const row = this.db
      .prepare('SELECT selectors FROM selector_cache WHERE url = ? AND schema_hash = ?')
      .get(url, schemaHash) as { selectors: string } | undefined

    return row ? JSON.parse(row.selectors) : null
  }

  set(url: string, schemaHash: string, selectors: Record<string, string>): void {
    this.db
      .prepare(
        `INSERT INTO selector_cache (url, schema_hash, selectors, last_success_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(url, schema_hash)
         DO UPDATE SET selectors = excluded.selectors,
                       last_success_at = excluded.last_success_at,
                       consecutive_failures = 0`
      )
      .run(url, schemaHash, JSON.stringify(selectors))
  }

  getFailureCount(url: string, schemaHash: string): number {
    const row = this.db
      .prepare('SELECT consecutive_failures FROM selector_cache WHERE url = ? AND schema_hash = ?')
      .get(url, schemaHash) as { consecutive_failures: number } | undefined

    return row?.consecutive_failures ?? 0
  }

  incrementFailures(url: string, schemaHash: string): void {
    this.db
      .prepare(
        `UPDATE selector_cache
         SET consecutive_failures = consecutive_failures + 1
         WHERE url = ? AND schema_hash = ?`
      )
      .run(url, schemaHash)
  }

  resetFailures(url: string, schemaHash: string): void {
    this.db
      .prepare(
        `UPDATE selector_cache
         SET consecutive_failures = 0, last_success_at = datetime('now')
         WHERE url = ? AND schema_hash = ?`
      )
      .run(url, schemaHash)
  }

  close(): void {
    this.db.close()
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/cache.test.ts`
Expected: 6 tests PASS

**Step 5: Commit**

```bash
git add src/cache.ts src/__tests__/cache.test.ts
git commit -m "feat: add SQLite selector cache with failure tracking"
```

---

### Task 5: CSS Selector Runner

**Files:**
- Create: `src/selector.ts`
- Create: `src/__tests__/selector.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/__tests__/selector.test.ts
import { describe, it, expect } from 'vitest'
import { runSelectors } from '../selector.js'

const HTML = `
<html>
<body>
  <h1 class="product-title">Widget Pro</h1>
  <span data-price="29.99">$29.99</span>
  <div class="rating" aria-label="4.5 out of 5">★★★★½</div>
  <span id="availability">In Stock</span>
  <input type="hidden" name="sku" value="SKU-123" />
  <img class="product-img" alt="Widget Pro front view" src="img.jpg" />
  <a class="brand-link" href="https://brand.com">BrandCo</a>
</body>
</html>
`

describe('runSelectors', () => {
  it('extracts text content by default', () => {
    const result = runSelectors(HTML, { title: 'h1.product-title' })
    expect(result.title).toBe('Widget Pro')
  })

  it('extracts aria-label when present', () => {
    const result = runSelectors(HTML, { rating: '.rating[aria-label]' })
    expect(result.rating).toBe('4.5 out of 5')
  })

  it('extracts value from input elements', () => {
    const result = runSelectors(HTML, { sku: 'input[name="sku"]' })
    expect(result.sku).toBe('SKU-123')
  })

  it('extracts alt from img elements', () => {
    const result = runSelectors(HTML, { image: 'img.product-img' })
    expect(result.image).toBe('Widget Pro front view')
  })

  it('extracts href from anchor elements', () => {
    const result = runSelectors(HTML, { brand: 'a.brand-link' })
    expect(result.brand).toBe('https://brand.com')
  })

  it('returns null for selectors with no matches', () => {
    const result = runSelectors(HTML, { missing: '.nonexistent' })
    expect(result.missing).toBeNull()
  })

  it('handles multiple selectors at once', () => {
    const result = runSelectors(HTML, {
      title: 'h1.product-title',
      price: '[data-price]',
      stock: '#availability',
    })
    expect(result.title).toBe('Widget Pro')
    expect(result.price).toBe('$29.99')
    expect(result.stock).toBe('In Stock')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/selector.test.ts`
Expected: FAIL — cannot find module '../selector.js'

**Step 3: Write implementation**

```typescript
// src/selector.ts
import * as cheerio from 'cheerio'

export function runSelectors(
  html: string,
  selectors: Record<string, string>,
): Record<string, string | null> {
  const $ = cheerio.load(html)
  const results: Record<string, string | null> = {}

  for (const [field, selector] of Object.entries(selectors)) {
    const el = $(selector).first()

    if (el.length === 0) {
      results[field] = null
      continue
    }

    const tagName = el.prop('tagName')?.toLowerCase()

    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
      results[field] = el.attr('value') ?? null
    } else if (tagName === 'img') {
      results[field] = el.attr('alt') ?? null
    } else if (tagName === 'a') {
      results[field] = el.attr('href') ?? null
    } else if (el.attr('aria-label')) {
      results[field] = el.attr('aria-label')!
    } else {
      results[field] = el.text().trim() || null
    }
  }

  return results
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/selector.test.ts`
Expected: 7 tests PASS

**Step 5: Commit**

```bash
git add src/selector.ts src/__tests__/selector.test.ts
git commit -m "feat: add CSS selector runner with smart value extraction"
```

---

### Task 6: HTML Cleaning (fetcher.ts)

**Files:**
- Create: `src/fetcher.ts`
- Create: `src/__tests__/fetcher.test.ts`

Note: This task implements both `cleanHtml` (testable, pure function) and `fetchAndClean` (Playwright integration, tested manually). Tests cover `cleanHtml` only.

**Step 1: Write the failing tests**

```typescript
// src/__tests__/fetcher.test.ts
import { describe, it, expect } from 'vitest'
import { cleanHtml } from '../fetcher.js'

describe('cleanHtml', () => {
  it('removes script tags', () => {
    const html = '<html><body><p>Hello</p><script>alert(1)</script></body></html>'
    const result = cleanHtml(html)
    expect(result).toContain('Hello')
    expect(result).not.toContain('script')
    expect(result).not.toContain('alert')
  })

  it('removes style, svg, noscript, iframe tags', () => {
    const html = `<html><body>
      <p>Content</p>
      <style>.x{color:red}</style>
      <svg><circle/></svg>
      <noscript>Enable JS</noscript>
      <iframe src="ad.html"></iframe>
    </body></html>`
    const result = cleanHtml(html)
    expect(result).toContain('Content')
    expect(result).not.toContain('style')
    expect(result).not.toContain('svg')
    expect(result).not.toContain('noscript')
    expect(result).not.toContain('iframe')
  })

  it('removes elements with inline display:none', () => {
    const html = '<html><body><p>Visible</p><p style="display:none">Hidden</p></body></html>'
    const result = cleanHtml(html)
    expect(result).toContain('Visible')
    expect(result).not.toContain('Hidden')
  })

  it('removes elements with inline visibility:hidden', () => {
    const html = '<html><body><p>Visible</p><p style="visibility: hidden">Hidden</p></body></html>'
    const result = cleanHtml(html)
    expect(result).toContain('Visible')
    expect(result).not.toContain('Hidden')
  })

  it('removes elements with hidden classes', () => {
    const html = `<html><body>
      <p>Visible</p>
      <p class="hidden">H1</p>
      <p class="d-none">H2</p>
      <p class="sr-only">H3</p>
    </body></html>`
    const result = cleanHtml(html)
    expect(result).toContain('Visible')
    expect(result).not.toContain('H1')
    expect(result).not.toContain('H2')
    expect(result).not.toContain('H3')
  })

  it('preserves allowed attributes and strips others', () => {
    const html = `<html><body>
      <div id="main" class="container" data-testid="box" onclick="hack()" style="color:red">
        <span aria-label="info" title="tooltip">Text</span>
        <input placeholder="Type here" tabindex="1" value="val" />
        <img alt="photo" width="100" src="img.jpg" />
        <a href="/page" target="_blank">Link</a>
      </div>
    </body></html>`
    const result = cleanHtml(html)

    // Allowed attributes preserved
    expect(result).toContain('id="main"')
    expect(result).toContain('class="container"')
    expect(result).toContain('data-testid="box"')
    expect(result).toContain('aria-label="info"')
    expect(result).toContain('placeholder="Type here"')
    expect(result).toContain('alt="photo"')
    expect(result).toContain('href="/page"')
    expect(result).toContain('src="img.jpg"')
    expect(result).toContain('value="val"')

    // Disallowed attributes stripped
    expect(result).not.toContain('onclick')
    expect(result).not.toContain('title=')
    expect(result).not.toContain('tabindex')
    expect(result).not.toContain('width=')
    expect(result).not.toContain('target=')
    // Note: style is stripped because it's not in the allowed list
    // (inline display:none elements are removed entirely before attribute stripping)
    expect(result).not.toContain('style=')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/fetcher.test.ts`
Expected: FAIL — cannot find module '../fetcher.js'

**Step 3: Write implementation**

```typescript
// src/fetcher.ts
import * as cheerio from 'cheerio'
import { chromium } from 'playwright'

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

export async function fetchAndClean(url: string): Promise<string> {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto(url, { waitUntil: 'networkidle' })
    const html = await page.content()
    return cleanHtml(html)
  } finally {
    await browser.close()
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/fetcher.test.ts`
Expected: 6 tests PASS

**Step 5: Commit**

```bash
git add src/fetcher.ts src/__tests__/fetcher.test.ts
git commit -m "feat: add HTML fetcher with Playwright and cheerio-based cleaning"
```

---

### Task 7: Prompt Templates

**Files:**
- Create: `src/prompts.ts`

**Step 1: Write prompt templates**

```typescript
// src/prompts.ts

export const GENERATE_SELECTORS_SYSTEM = `You are an expert web scraper. Given cleaned HTML and a list of data fields to extract, return one CSS selector per field that will match the element containing that field's value.

Rules:
- Return exactly one CSS selector per field
- Prefer stable attributes: id, data-*, aria-label over class names
- Prefer semantic elements (h1, main, article) over generic divs
- Each selector should match exactly one element on the page
- Do not use overly specific selectors that break on minor HTML changes
- Do not use nth-child or positional selectors unless absolutely necessary`

export function generateSelectorsPrompt(
  html: string,
  fields: { name: string; type: string }[],
): string {
  const fieldList = fields
    .map((f) => `- "${f.name}" (expected type: ${f.type})`)
    .join('\n')

  return `Here is the cleaned HTML of a web page:

<html>
${html}
</html>

I need to extract the following fields:
${fieldList}

For each field, provide a CSS selector that targets the element containing its value. Return a JSON object mapping field names to CSS selectors.`
}

export const FIX_SELECTORS_SYSTEM = `You are an expert web scraper debugging extraction failures. Given the HTML, previously attempted CSS selectors, and the validation errors that occurred, fix the broken selectors.

Rules:
- Only fix selectors for fields that failed validation
- Keep working selectors unchanged
- Analyze why the previous selector failed (wrong element? no match? wrong attribute?)
- Prefer stable attributes: id, data-*, aria-label over class names
- Each selector should match exactly one element on the page`

export function fixSelectorsPrompt(
  html: string,
  previousSelectors: Record<string, string>,
  errors: string,
  rawData: unknown,
): string {
  return `Here is the cleaned HTML of a web page:

<html>
${html}
</html>

I previously used these CSS selectors:
${JSON.stringify(previousSelectors, null, 2)}

The extracted raw data was:
${JSON.stringify(rawData, null, 2)}

Validation failed with these errors:
${errors}

Fix the broken selectors and return the complete set (both working and fixed selectors) as a JSON object mapping field names to CSS selectors.`
}
```

**Step 2: Commit**

```bash
git add src/prompts.ts
git commit -m "feat: add prompt templates for selector generation and fixing"
```

---

### Task 8: LLM Integration

**Files:**
- Create: `src/llm.ts`
- Create: `src/__tests__/llm.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/__tests__/llm.test.ts
import { describe, it, expect, vi } from 'vitest'
import { generateSelectors, fixSelectors, type LLMConfig } from '../llm.js'

// Mock the ai module
vi.mock('ai', () => ({
  generateObject: vi.fn(),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn((model: string) => ({ modelId: model, provider: 'anthropic' }))),
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => vi.fn((model: string) => ({ modelId: model, provider: 'openai' }))),
}))

import { generateObject } from 'ai'

const mockGenerateObject = vi.mocked(generateObject)

const config: LLMConfig = {
  provider: 'anthropic',
  apiKey: 'test-key',
  model: 'claude-haiku-4-5-20251001',
}

const html = '<html><body><h1>Product</h1><span class="price">$10</span></body></html>'

describe('generateSelectors', () => {
  it('calls generateObject and returns selectors', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        selectors: { title: 'h1', price: '.price' },
      },
    } as any)

    const result = await generateSelectors(html, ['title', 'price'], config)
    expect(result).toEqual({ title: 'h1', price: '.price' })
    expect(mockGenerateObject).toHaveBeenCalledOnce()
  })
})

describe('fixSelectors', () => {
  it('calls generateObject with failure context and returns fixed selectors', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        selectors: { title: 'h1', price: 'span.price' },
      },
    } as any)

    const result = await fixSelectors(
      html,
      { title: 'h1', price: '.wrong' },
      'price: Expected number, received NaN',
      { title: 'Product', price: null },
      config,
    )
    expect(result).toEqual({ title: 'h1', price: 'span.price' })
    expect(mockGenerateObject).toHaveBeenCalledOnce()
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/llm.test.ts`
Expected: FAIL — cannot find module '../llm.js'

**Step 3: Write implementation**

```typescript
// src/llm.ts
import { generateObject } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { z } from 'zod'
import {
  GENERATE_SELECTORS_SYSTEM,
  generateSelectorsPrompt,
  FIX_SELECTORS_SYSTEM,
  fixSelectorsPrompt,
} from './prompts.js'

export interface LLMConfig {
  provider: 'anthropic' | 'openai'
  apiKey: string
  model: string
}

function createModel(config: LLMConfig) {
  if (config.provider === 'anthropic') {
    const provider = createAnthropic({ apiKey: config.apiKey })
    return provider(config.model)
  }
  const provider = createOpenAI({ apiKey: config.apiKey })
  return provider(config.model)
}

function selectorsSchema(fieldNames: string[]) {
  const shape: Record<string, z.ZodString> = {}
  for (const name of fieldNames) {
    shape[name] = z.string()
  }
  return z.object({
    selectors: z.object(shape),
  })
}

export async function generateSelectors(
  html: string,
  fieldNames: string[],
  config: LLMConfig,
): Promise<Record<string, string>> {
  const fields = fieldNames.map((name) => ({ name, type: 'string' }))
  const model = createModel(config)

  const { object } = await generateObject({
    model,
    schema: selectorsSchema(fieldNames),
    system: GENERATE_SELECTORS_SYSTEM,
    prompt: generateSelectorsPrompt(html, fields),
  })

  return object.selectors
}

export async function fixSelectors(
  html: string,
  previousSelectors: Record<string, string>,
  errors: string,
  rawData: unknown,
  config: LLMConfig,
): Promise<Record<string, string>> {
  const fieldNames = Object.keys(previousSelectors)
  const model = createModel(config)

  const { object } = await generateObject({
    model,
    schema: selectorsSchema(fieldNames),
    system: FIX_SELECTORS_SYSTEM,
    prompt: fixSelectorsPrompt(html, previousSelectors, errors, rawData),
  })

  return object.selectors
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/llm.test.ts`
Expected: 2 tests PASS

**Step 5: Commit**

```bash
git add src/llm.ts src/__tests__/llm.test.ts
git commit -m "feat: add LLM integration for selector generation via Vercel AI SDK"
```

---

### Task 9: Main Scraper Class

**Files:**
- Create: `src/scraper.ts`
- Create: `src/__tests__/scraper.test.ts`

**Step 1: Write the failing tests**

These tests mock all internal modules to test the orchestration logic in isolation.

```typescript
// src/__tests__/scraper.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// Mock dependencies
vi.mock('../fetcher.js', () => ({
  fetchAndClean: vi.fn(),
}))

vi.mock('../llm.js', () => ({
  generateSelectors: vi.fn(),
  fixSelectors: vi.fn(),
}))

import { fetchAndClean } from '../fetcher.js'
import { generateSelectors, fixSelectors } from '../llm.js'
import { Scraper } from '../scraper.js'
import { ExtractionFailed, PermanentFailure } from '../exceptions.js'

const mockFetch = vi.mocked(fetchAndClean)
const mockGenerate = vi.mocked(generateSelectors)
const mockFix = vi.mocked(fixSelectors)

const PRODUCT_HTML = `<html><body>
  <h1>Widget</h1>
  <span class="price">29.99</span>
  <span id="stock">true</span>
</body></html>`

const schema = z.object({
  title: z.string(),
  price: z.coerce.number().positive(),
  inStock: z.coerce.boolean(),
})

describe('Scraper', () => {
  let scraper: Scraper
  let tmpDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'healscrape-test-'))
    scraper = new Scraper({
      provider: 'anthropic',
      apiKey: 'test-key',
      model: 'test-model',
      cachePath: path.join(tmpDir, 'cache.db'),
    })
  })

  afterEach(() => {
    scraper.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('generates selectors, extracts data, caches, and returns typed result', async () => {
    mockFetch.mockResolvedValueOnce(PRODUCT_HTML)
    mockGenerate.mockResolvedValueOnce({
      title: 'h1',
      price: '.price',
      inStock: '#stock',
    })

    const result = await scraper.scrape({ url: 'https://example.com/product', schema })

    expect(result).toEqual({ title: 'Widget', price: 29.99, inStock: true })
    expect(mockGenerate).toHaveBeenCalledOnce()
  })

  it('uses cached selectors on second call (no LLM)', async () => {
    mockFetch.mockResolvedValue(PRODUCT_HTML)
    mockGenerate.mockResolvedValueOnce({
      title: 'h1',
      price: '.price',
      inStock: '#stock',
    })

    await scraper.scrape({ url: 'https://example.com/product', schema })
    const result = await scraper.scrape({ url: 'https://example.com/product', schema })

    expect(result).toEqual({ title: 'Widget', price: 29.99, inStock: true })
    expect(mockGenerate).toHaveBeenCalledOnce() // NOT called again
  })

  it('heals selectors when validation fails then retried selectors work', async () => {
    mockFetch.mockResolvedValueOnce(PRODUCT_HTML)
    // First attempt: bad price selector
    mockGenerate.mockResolvedValueOnce({
      title: 'h1',
      price: '.nonexistent',
      inStock: '#stock',
    })
    // Fix: correct price selector
    mockFix.mockResolvedValueOnce({
      title: 'h1',
      price: '.price',
      inStock: '#stock',
    })

    const result = await scraper.scrape({ url: 'https://example.com/product', schema })

    expect(result).toEqual({ title: 'Widget', price: 29.99, inStock: true })
    expect(mockFix).toHaveBeenCalledOnce()
  })

  it('throws ExtractionFailed when healing also fails', async () => {
    mockFetch.mockResolvedValueOnce(PRODUCT_HTML)
    mockGenerate.mockResolvedValueOnce({
      title: 'h1',
      price: '.nonexistent',
      inStock: '#stock',
    })
    mockFix.mockResolvedValueOnce({
      title: 'h1',
      price: '.still-nonexistent',
      inStock: '#stock',
    })

    await expect(
      scraper.scrape({ url: 'https://example.com/product', schema }),
    ).rejects.toThrow(ExtractionFailed)
  })

  it('throws PermanentFailure after 4+ consecutive failures', async () => {
    mockFetch.mockResolvedValue(PRODUCT_HTML)
    mockGenerate.mockResolvedValue({
      title: 'h1',
      price: '.nonexistent',
      inStock: '#stock',
    })
    mockFix.mockResolvedValue({
      title: 'h1',
      price: '.still-nonexistent',
      inStock: '#stock',
    })

    // Fail 4 times
    for (let i = 0; i < 4; i++) {
      await scraper.scrape({ url: 'https://example.com/product', schema }).catch(() => {})
    }

    // 5th attempt should throw PermanentFailure immediately
    await expect(
      scraper.scrape({ url: 'https://example.com/product', schema }),
    ).rejects.toThrow(PermanentFailure)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/scraper.test.ts`
Expected: FAIL — cannot find module '../scraper.js'

**Step 3: Write implementation**

```typescript
// src/scraper.ts
import crypto from 'node:crypto'
import { type ZodObject, type ZodRawShape } from 'zod'
import { SelectorCache } from './cache.js'
import { fetchAndClean } from './fetcher.js'
import { generateSelectors, fixSelectors, type LLMConfig } from './llm.js'
import { runSelectors } from './selector.js'
import { validate } from './validator.js'
import { ExtractionFailed, PermanentFailure } from './exceptions.js'

const MAX_CONSECUTIVE_FAILURES = 3

export interface ScraperConfig {
  provider: 'anthropic' | 'openai'
  apiKey: string
  model: string
  cachePath?: string
}

interface ScrapeOptions<T extends ZodRawShape> {
  url: string
  schema: ZodObject<T>
}

function computeSchemaHash(schema: ZodObject<ZodRawShape>): string {
  const fields: Record<string, string> = {}
  for (const [key, value] of Object.entries(schema.shape)) {
    fields[key] = value.constructor.name
  }
  const content = JSON.stringify(fields, Object.keys(fields).sort())
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
}

export class Scraper {
  private cache: SelectorCache
  private llmConfig: LLMConfig

  constructor(config: ScraperConfig) {
    this.cache = new SelectorCache(config.cachePath)
    this.llmConfig = {
      provider: config.provider,
      apiKey: config.apiKey,
      model: config.model,
    }
  }

  async scrape<T extends ZodRawShape>(
    options: ScrapeOptions<T>,
  ): Promise<ReturnType<ZodObject<T>['parse']>> {
    const { url, schema } = options
    const schemaHash = computeSchemaHash(schema as unknown as ZodObject<ZodRawShape>)

    // Guard: check for permanent failure
    const failureCount = this.cache.getFailureCount(url, schemaHash)
    if (failureCount > MAX_CONSECUTIVE_FAILURES) {
      throw new PermanentFailure({ url, failureCount })
    }

    // 1. Fetch and clean page
    const cleanedHtml = await fetchAndClean(url)

    // 2. Check cache for selectors
    let selectors = this.cache.get(url, schemaHash)

    // 3. Generate selectors if no cache
    const fieldNames = Object.keys(schema.shape)
    if (!selectors) {
      selectors = await generateSelectors(cleanedHtml, fieldNames, this.llmConfig)
    }

    // 4. Run selectors
    const rawData = runSelectors(cleanedHtml, selectors)

    // 5. Validate
    const result = validate(schema, rawData)

    if (result.success) {
      this.cache.set(url, schemaHash, selectors)
      this.cache.resetFailures(url, schemaHash)
      return result.data
    }

    // 6. Healing attempt
    const fixedSelectors = await fixSelectors(
      cleanedHtml,
      selectors,
      result.errors,
      result.rawData,
      this.llmConfig,
    )
    const retryRawData = runSelectors(cleanedHtml, fixedSelectors)
    const retryResult = validate(schema, retryRawData)

    if (retryResult.success) {
      this.cache.set(url, schemaHash, fixedSelectors)
      this.cache.resetFailures(url, schemaHash)
      return retryResult.data
    }

    // 7. Failure
    this.cache.incrementFailures(url, schemaHash)
    throw new ExtractionFailed({
      url,
      errors: retryResult.errors,
      rawData: retryResult.rawData,
      selectors: fixedSelectors,
    })
  }

  close(): void {
    this.cache.close()
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/scraper.test.ts`
Expected: 5 tests PASS

**Step 5: Commit**

```bash
git add src/scraper.ts src/__tests__/scraper.test.ts
git commit -m "feat: add main Scraper class with caching and self-healing loop"
```

---

### Task 10: Public Exports, Examples, README

**Files:**
- Modify: `src/index.ts`
- Create: `examples/basic.ts`
- Create: `examples/ecommerce.ts`
- Create: `README.md`

**Step 1: Write public exports**

```typescript
// src/index.ts
export { Scraper, type ScraperConfig } from './scraper.js'
export { ExtractionFailed, PermanentFailure } from './exceptions.js'
```

**Step 2: Write basic example**

```typescript
// examples/basic.ts
import { Scraper } from '../src/index.js'
import { z } from 'zod'

const scraper = new Scraper({
  provider: 'anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-haiku-4-5-20251001',
})

const ArticleSchema = z.object({
  title: z.string(),
  author: z.string(),
  publishDate: z.string(),
})

async function main() {
  try {
    const article = await scraper.scrape({
      url: 'https://example.com/blog/post',
      schema: ArticleSchema,
    })
    console.log('Extracted:', article)
  } catch (err) {
    console.error('Failed:', err)
  } finally {
    scraper.close()
  }
}

main()
```

**Step 3: Write ecommerce example**

```typescript
// examples/ecommerce.ts
import { Scraper, ExtractionFailed } from '../src/index.js'
import { z } from 'zod'

const scraper = new Scraper({
  provider: 'anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-haiku-4-5-20251001',
})

// Use z.coerce for fields extracted as strings from HTML
const ProductSchema = z.object({
  title: z.string(),
  price: z.coerce.number().positive(),
  rating: z.coerce.number().min(0).max(5),
  inStock: z.coerce.boolean(),
})

async function main() {
  try {
    const product = await scraper.scrape({
      url: 'https://example.com/product/widget-pro',
      schema: ProductSchema,
    })

    console.log(`${product.title}: $${product.price}`)
    console.log(`Rating: ${product.rating}/5`)
    console.log(`In stock: ${product.inStock}`)
  } catch (err) {
    if (err instanceof ExtractionFailed) {
      console.error('Extraction failed:', err.message)
      console.error('Raw data:', err.rawData)
      console.error('Selectors tried:', err.selectors)
    } else {
      throw err
    }
  } finally {
    scraper.close()
  }
}

main()
```

**Step 4: Write README**

```markdown
# healscrape

Schema-first, self-healing web scraping powered by LLMs. Define what you want with a Zod schema, and healscrape figures out how to extract it.

## How it works

1. You provide a URL and a Zod schema describing the data you want
2. healscrape fetches the page with Playwright (handles JS rendering)
3. An LLM generates CSS selectors for each schema field
4. Selectors are run against the page to extract raw values
5. Zod validates and coerces the extracted data
6. Working selectors are cached in SQLite — subsequent runs are free (no LLM calls)
7. If the page changes and selectors break, healscrape asks the LLM to fix them

## Installation

```bash
npm install healscrape
npx playwright install chromium
```

## Quick Start

```typescript
import { Scraper } from 'healscrape'
import { z } from 'zod'

const scraper = new Scraper({
  provider: 'anthropic',  // or 'openai'
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-haiku-4-5-20251001',
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

console.log(product.title)  // fully typed!

// Close when done to release the SQLite connection
scraper.close()
```

## Important: Use `z.coerce` for non-string fields

CSS selectors extract text from HTML, which means all raw values are strings. Use `z.coerce.number()`, `z.coerce.boolean()`, etc. instead of `z.number()`, `z.boolean()` so Zod can convert `"29.99"` → `29.99` and `"true"` → `true`.

## Caching

Working selectors are stored in `.healscrape/cache.db` (SQLite) in your project root. This means:

- **First scrape** of a URL+schema combo calls the LLM (~1-2s)
- **Subsequent scrapes** use cached selectors (instant, free)
- **If selectors break** (page changed), healscrape automatically asks the LLM to fix them
- **After 4 consecutive failures**, healscrape throws `PermanentFailure` to avoid wasting tokens

### Custom cache location

```typescript
const scraper = new Scraper({
  // ...
  cachePath: '/path/to/custom/cache.db',
})
```

### Clearing the cache

Delete the cache file to start fresh:

```bash
rm -rf .healscrape/
```

## Error Handling

```typescript
import { Scraper, ExtractionFailed, PermanentFailure } from 'healscrape'

try {
  const data = await scraper.scrape({ url, schema })
} catch (err) {
  if (err instanceof ExtractionFailed) {
    // LLM couldn't generate working selectors
    console.error(err.message)    // human-readable summary
    console.error(err.rawData)    // what was actually extracted
    console.error(err.selectors)  // the CSS selectors that were tried
  } else if (err instanceof PermanentFailure) {
    // Too many consecutive failures for this URL+schema
    // Clear the cache and try again, or check if the site changed
    console.error(err.message)
  }
}
```

## Supported Providers

- **Anthropic**: `provider: 'anthropic'` — works with Claude models
- **OpenAI**: `provider: 'openai'` — works with GPT models

## License

MIT
```

**Step 5: Verify build still works**

Run: `npx tsup`
Expected: Build succeeds

**Step 6: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

**Step 7: Commit**

```bash
git add src/index.ts examples/ README.md
git commit -m "feat: add public exports, examples, and README"
```

---

## Summary

| Task | Module | Tests |
|------|--------|-------|
| 1 | Project scaffolding | — |
| 2 | `exceptions.ts` | 2 tests |
| 3 | `validator.ts` | 3 tests |
| 4 | `cache.ts` | 6 tests |
| 5 | `selector.ts` | 7 tests |
| 6 | `fetcher.ts` | 6 tests |
| 7 | `prompts.ts` | — |
| 8 | `llm.ts` | 2 tests (mocked) |
| 9 | `scraper.ts` | 5 tests (mocked) |
| 10 | `index.ts`, examples, README | build check |

**Total: 31 tests across 7 test files, 10 source modules**
