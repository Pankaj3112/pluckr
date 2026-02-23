# LLM Transform Generation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the LLM selector generation to produce a JavaScript transform expression per field, replacing Zod coercion with LLM-generated type conversions.

**Architecture:** The LLM returns `{ selector, transform }` per field instead of just a selector string. Transforms are JS expressions executed via `new Function` that convert raw extracted strings to typed values. The new `FieldMappings` type threads through llm → selector → cache → scraper. Schema metadata (Zod type + description) feeds into the prompt so the LLM generates context-aware transforms.

**Tech Stack:** TypeScript, Zod, cheerio, Vercel AI SDK (`ai`), better-sqlite3, vitest

**Design doc:** `docs/plans/2026-02-23-transform-design.md`

---

### Task 1: Add FieldMapping type and update exceptions

**Files:**
- Create: `src/types.ts`
- Modify: `src/exceptions.ts`
- Modify: `src/__tests__/exceptions.test.ts`

**Step 1: Write the failing test for ExtractionFailed with fieldMappings**

Update `src/__tests__/exceptions.test.ts` — change the test to use `fieldMappings` instead of `selectors`:

```typescript
import { describe, it, expect } from 'vitest'
import { ExtractionFailed, PermanentFailure } from '../exceptions.js'
import type { FieldMappings } from '../types.js'

describe('ExtractionFailed', () => {
  it('stores context and formats message', () => {
    const fieldMappings: FieldMappings = {
      title: { selector: 'h1', transform: 'value.trim()' },
      price: { selector: '.price', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
    }

    const err = new ExtractionFailed({
      url: 'https://example.com',
      errors: 'price: Expected number, received NaN',
      rawData: { title: 'Widget', price: 'N/A' },
      fieldMappings,
    })

    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ExtractionFailed')
    expect(err.message).toContain('https://example.com')
    expect(err.message).toContain('price: Expected number, received NaN')
    expect(err.url).toBe('https://example.com')
    expect(err.errors).toBe('price: Expected number, received NaN')
    expect(err.rawData).toEqual({ title: 'Widget', price: 'N/A' })
    expect(err.fieldMappings).toEqual(fieldMappings)
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

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/exceptions.test.ts`
Expected: FAIL — `../types.js` does not exist, `fieldMappings` property does not exist on `ExtractionFailed`

**Step 3: Create types.ts and update exceptions.ts**

Create `src/types.ts`:

```typescript
export interface FieldMapping {
  selector: string
  transform: string
}

export type FieldMappings = Record<string, FieldMapping>
```

Update `src/exceptions.ts` — replace `selectors: Record<string, string>` with `fieldMappings: FieldMappings`:

```typescript
import type { FieldMappings } from './types.js'

interface ExtractionFailedOptions {
  url: string
  errors: string
  rawData: unknown
  fieldMappings: FieldMappings
}

export class ExtractionFailed extends Error {
  readonly url: string
  readonly errors: string
  readonly rawData: unknown
  readonly fieldMappings: FieldMappings

  constructor({ url, errors, rawData, fieldMappings }: ExtractionFailedOptions) {
    super(`Failed to extract data from ${url}: ${errors}`)
    this.name = 'ExtractionFailed'
    this.url = url
    this.errors = errors
    this.rawData = rawData
    this.fieldMappings = fieldMappings
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

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/exceptions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/types.ts src/exceptions.ts src/__tests__/exceptions.test.ts
git commit -m "feat: add FieldMapping type and update ExtractionFailed to use fieldMappings"
```

---

### Task 2: Update prompts for transform generation

**Files:**
- Modify: `src/prompts.ts`

No dedicated test file for prompts — they're pure string functions tested indirectly through `llm.test.ts`. We update prompts first, then test them in Task 3.

**Step 1: Update the generate system prompt and user prompt**

Replace the full content of `src/prompts.ts` with:

```typescript
export interface FieldInfo {
  name: string
  type: string
  description?: string
}

export const GENERATE_SELECTORS_SYSTEM = `You are an expert web scraper. Given cleaned HTML and a list of data fields to extract, return one CSS selector and one JavaScript transform expression per field.

Rules for selectors:
- Return exactly one CSS selector per field
- Prefer stable attributes: id, data-*, aria-label over class names
- Prefer semantic elements (h1, main, article) over generic divs
- Each selector should match exactly one element on the page
- Do not use overly specific selectors that break on minor HTML changes
- Do not use nth-child or positional selectors unless absolutely necessary

Rules for transforms:
- Each transform is a JavaScript expression that receives a variable \`value\` (string) and returns the correctly typed result
- If the field has an instruction, follow it for the transform
- For number fields without instruction: parseFloat(value.replace(/[^0-9.-]/g, ''))
- For boolean fields without instruction: Boolean(value.trim())
- For string fields without instruction: value.trim()`

export function generateSelectorsPrompt(
  html: string,
  fields: FieldInfo[],
): string {
  const fieldList = fields
    .map((f) => {
      const parts = [`"${f.name}" (type: ${f.type})`]
      if (f.description) {
        parts[0] = `"${f.name}" (type: ${f.type}, instruction: "${f.description}")`
      }
      return `- ${parts[0]}`
    })
    .join('\n')

  return `Here is the cleaned HTML of a web page:

<html>
${html}
</html>

I need to extract the following fields:
${fieldList}

For each field, provide a CSS selector that targets the element containing its value and a JavaScript transform expression that converts the raw text to the correct type. The transform receives a variable \`value\` (string).`
}

export const FIX_SELECTORS_SYSTEM = `You are an expert web scraper debugging extraction failures. Given the HTML, previously attempted CSS selectors with transforms, and the validation errors that occurred, fix the broken selectors and/or transforms.

Rules:
- Only fix fields that failed validation
- Keep working selectors and transforms unchanged
- Analyze why the previous attempt failed (wrong element? no match? wrong transform?)
- Prefer stable attributes: id, data-*, aria-label over class names
- Each selector should match exactly one element on the page
- Each transform is a JavaScript expression receiving \`value\` (string)`

export function fixSelectorsPrompt(
  html: string,
  previousMappings: Record<string, { selector: string; transform: string }>,
  errors: string,
  rawData: unknown,
): string {
  return `Here is the cleaned HTML of a web page:

<html>
${html}
</html>

I previously used these field mappings (selector + transform per field):
${JSON.stringify(previousMappings, null, 2)}

The extracted raw data was:
${JSON.stringify(rawData, null, 2)}

Validation failed with these errors:
${errors}

Fix the broken selectors and/or transforms and return the complete set (both working and fixed) as a JSON object mapping field names to {selector, transform} objects.`
}
```

**Step 2: Run existing tests to see what breaks**

Run: `npx vitest run`
Expected: Failures in `llm.test.ts` and `scraper.test.ts` due to changed function signatures. This is expected — we fix those in Tasks 3 and 6.

**Step 3: Commit**

```bash
git add src/prompts.ts
git commit -m "feat: update prompts to request selector + transform per field"
```

---

### Task 3: Update LLM module to return FieldMappings

**Files:**
- Modify: `src/llm.ts`
- Modify: `src/__tests__/llm.test.ts`

**Step 1: Write the failing tests**

Replace the full content of `src/__tests__/llm.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LanguageModel } from 'ai'
import type { FieldInfo } from '../prompts.js'
import { generateFieldMappings, fixFieldMappings } from '../llm.js'

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    generateObject: vi.fn(),
  }
})

import { generateObject } from 'ai'

const mockGenerateObject = vi.mocked(generateObject)

const fakeModel = { modelId: 'test-model' } as LanguageModel

const html = '<html><body><h1>Product</h1><span class="price">$10</span></body></html>'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('generateFieldMappings', () => {
  it('calls generateObject and returns field mappings with selectors and transforms', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        title: { selector: 'h1', transform: 'value.trim()' },
        price: { selector: '.price', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
      },
    } as any)

    const fields: FieldInfo[] = [
      { name: 'title', type: 'ZodString' },
      { name: 'price', type: 'ZodNumber', description: 'strip currency symbol' },
    ]

    const result = await generateFieldMappings(html, fields, fakeModel)

    expect(result).toEqual({
      title: { selector: 'h1', transform: 'value.trim()' },
      price: { selector: '.price', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
    })
    expect(mockGenerateObject).toHaveBeenCalledOnce()
  })
})

describe('fixFieldMappings', () => {
  it('calls generateObject with failure context and returns fixed field mappings', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        title: { selector: 'h1', transform: 'value.trim()' },
        price: { selector: 'span.price', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
      },
    } as any)

    const result = await fixFieldMappings(
      html,
      {
        title: { selector: 'h1', transform: 'value.trim()' },
        price: { selector: '.wrong', transform: "parseFloat(value)" },
      },
      'price: Expected number, received NaN',
      { title: 'Product', price: null },
      fakeModel,
    )

    expect(result).toEqual({
      title: { selector: 'h1', transform: 'value.trim()' },
      price: { selector: 'span.price', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
    })
    expect(mockGenerateObject).toHaveBeenCalledOnce()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/llm.test.ts`
Expected: FAIL — `generateFieldMappings` and `fixFieldMappings` don't exist

**Step 3: Implement the updated llm.ts**

Replace the full content of `src/llm.ts`:

```typescript
import { generateObject, type LanguageModel } from 'ai'
import { z } from 'zod'
import type { FieldMappings } from './types.js'
import {
  type FieldInfo,
  GENERATE_SELECTORS_SYSTEM,
  generateSelectorsPrompt,
  FIX_SELECTORS_SYSTEM,
  fixSelectorsPrompt,
} from './prompts.js'

function fieldMappingsSchema(fieldNames: string[]) {
  const shape: Record<string, z.ZodObject<{ selector: z.ZodString; transform: z.ZodString }>> = {}
  for (const name of fieldNames) {
    shape[name] = z.object({
      selector: z.string(),
      transform: z.string(),
    })
  }
  return z.object(shape)
}

export async function generateFieldMappings(
  html: string,
  fields: FieldInfo[],
  model: LanguageModel,
): Promise<FieldMappings> {
  const fieldNames = fields.map((f) => f.name)

  const { object } = await generateObject({
    model,
    temperature: 0.2,
    schema: fieldMappingsSchema(fieldNames),
    system: GENERATE_SELECTORS_SYSTEM,
    prompt: generateSelectorsPrompt(html, fields),
  })

  return object
}

export async function fixFieldMappings(
  html: string,
  previousMappings: FieldMappings,
  errors: string,
  rawData: unknown,
  model: LanguageModel,
): Promise<FieldMappings> {
  const fieldNames = Object.keys(previousMappings)

  const { object } = await generateObject({
    model,
    temperature: 0.2,
    schema: fieldMappingsSchema(fieldNames),
    system: FIX_SELECTORS_SYSTEM,
    prompt: fixSelectorsPrompt(html, previousMappings, errors, rawData),
  })

  return object
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/llm.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/llm.ts src/__tests__/llm.test.ts
git commit -m "feat: update LLM module to generate field mappings with transforms"
```

---

### Task 4: Update selector execution to apply transforms

**Files:**
- Modify: `src/selector.ts`
- Modify: `src/__tests__/selector.test.ts`

**Step 1: Write the failing tests**

Replace the full content of `src/__tests__/selector.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { runSelectors } from '../selector.js'
import type { FieldMappings } from '../types.js'

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
  it('extracts text and applies string transform', () => {
    const mappings: FieldMappings = {
      title: { selector: 'h1.product-title', transform: 'value.trim()' },
    }
    const result = runSelectors(HTML, mappings)
    expect(result.title).toBe('Widget Pro')
  })

  it('extracts text and applies number transform', () => {
    const mappings: FieldMappings = {
      price: { selector: '[data-price]', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
    }
    const result = runSelectors(HTML, mappings)
    expect(result.price).toBe(29.99)
  })

  it('extracts text and applies boolean transform', () => {
    const mappings: FieldMappings = {
      inStock: { selector: '#availability', transform: "value.toLowerCase().includes('in stock')" },
    }
    const result = runSelectors(HTML, mappings)
    expect(result.inStock).toBe(true)
  })

  it('extracts aria-label when present', () => {
    const mappings: FieldMappings = {
      rating: { selector: '.rating[aria-label]', transform: 'parseFloat(value)' },
    }
    const result = runSelectors(HTML, mappings)
    expect(result.rating).toBe(4.5)
  })

  it('extracts value from input elements', () => {
    const mappings: FieldMappings = {
      sku: { selector: 'input[name="sku"]', transform: 'value.trim()' },
    }
    const result = runSelectors(HTML, mappings)
    expect(result.sku).toBe('SKU-123')
  })

  it('extracts alt from img elements', () => {
    const mappings: FieldMappings = {
      image: { selector: 'img.product-img', transform: 'value.trim()' },
    }
    const result = runSelectors(HTML, mappings)
    expect(result.image).toBe('Widget Pro front view')
  })

  it('extracts href from anchor elements', () => {
    const mappings: FieldMappings = {
      brand: { selector: 'a.brand-link', transform: 'value.trim()' },
    }
    const result = runSelectors(HTML, mappings)
    expect(result.brand).toBe('https://brand.com')
  })

  it('returns null for selectors with no matches', () => {
    const mappings: FieldMappings = {
      missing: { selector: '.nonexistent', transform: 'value.trim()' },
    }
    const result = runSelectors(HTML, mappings)
    expect(result.missing).toBeNull()
  })

  it('returns null when transform throws', () => {
    const mappings: FieldMappings = {
      title: { selector: 'h1.product-title', transform: 'value.nonExistentMethod()' },
    }
    const result = runSelectors(HTML, mappings)
    expect(result.title).toBeNull()
  })

  it('handles multiple fields at once', () => {
    const mappings: FieldMappings = {
      title: { selector: 'h1.product-title', transform: 'value.trim()' },
      price: { selector: '[data-price]', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
      stock: { selector: '#availability', transform: 'value.trim()' },
    }
    const result = runSelectors(HTML, mappings)
    expect(result.title).toBe('Widget Pro')
    expect(result.price).toBe(29.99)
    expect(result.stock).toBe('In Stock')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/selector.test.ts`
Expected: FAIL — `runSelectors` expects `Record<string, string>`, not `FieldMappings`

**Step 3: Implement the updated selector.ts**

Replace the full content of `src/selector.ts`:

```typescript
import * as cheerio from 'cheerio'
import type { FieldMappings } from './types.js'

function extractRawValue(el: cheerio.Cheerio<cheerio.Element>): string | null {
  const tagName = el.prop('tagName')?.toLowerCase()

  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return el.attr('value') ?? null
  } else if (tagName === 'img') {
    return el.attr('alt') ?? null
  } else if (tagName === 'a') {
    return el.attr('href') ?? null
  } else if (el.attr('aria-label')) {
    return el.attr('aria-label')!
  } else {
    return el.text().trim() || null
  }
}

export function runSelectors(
  html: string,
  fieldMappings: FieldMappings,
): Record<string, unknown> {
  const $ = cheerio.load(html)
  const results: Record<string, unknown> = {}

  for (const [field, { selector, transform }] of Object.entries(fieldMappings)) {
    const el = $(selector).first()

    if (el.length === 0) {
      results[field] = null
      continue
    }

    const rawValue = extractRawValue(el)
    if (rawValue === null) {
      results[field] = null
      continue
    }

    try {
      const fn = new Function('value', `return ${transform}`)
      results[field] = fn(rawValue)
    } catch {
      results[field] = null
    }
  }

  return results
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/selector.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/selector.ts src/__tests__/selector.test.ts
git commit -m "feat: update runSelectors to accept FieldMappings and apply transforms"
```

---

### Task 5: Update cache type annotations

**Files:**
- Modify: `src/cache.ts`
- Modify: `src/__tests__/cache.test.ts`

**Step 1: Write the failing test**

Update `src/__tests__/cache.test.ts` to use `FieldMappings`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SelectorCache } from '../cache.js'
import type { FieldMappings } from '../types.js'
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

  it('stores and retrieves field mappings', () => {
    const mappings: FieldMappings = {
      title: { selector: 'h1', transform: 'value.trim()' },
      price: { selector: '.price', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
    }
    cache.set('https://example.com', 'abc123', mappings)

    const result = cache.get('https://example.com', 'abc123')
    expect(result).toEqual(mappings)
  })

  it('updates field mappings on duplicate key', () => {
    const original: FieldMappings = { title: { selector: 'h1', transform: 'value.trim()' } }
    const updated: FieldMappings = { title: { selector: 'h2.new', transform: 'value.toUpperCase()' } }

    cache.set('https://example.com', 'abc123', original)
    cache.set('https://example.com', 'abc123', updated)

    const result = cache.get('https://example.com', 'abc123')
    expect(result).toEqual(updated)
  })

  it('tracks consecutive failures', () => {
    cache.set('https://example.com', 'abc123', {
      title: { selector: 'h1', transform: 'value.trim()' },
    })

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
    const a: FieldMappings = { title: { selector: 'h1', transform: 'value.trim()' } }
    const b: FieldMappings = { title: { selector: 'h2', transform: 'value.trim()' } }
    const c: FieldMappings = { title: { selector: 'h3', transform: 'value.trim()' } }

    cache.set('https://a.com', 'hash1', a)
    cache.set('https://b.com', 'hash1', b)
    cache.set('https://a.com', 'hash2', c)

    expect(cache.get('https://a.com', 'hash1')).toEqual(a)
    expect(cache.get('https://b.com', 'hash1')).toEqual(b)
    expect(cache.get('https://a.com', 'hash2')).toEqual(c)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/cache.test.ts`
Expected: FAIL — `cache.set()` TypeScript error (expects `Record<string, string>`, gets `FieldMappings`)

**Step 3: Update cache.ts type annotations**

In `src/cache.ts`, update the type annotations on `get` and `set` methods. The `import` and the two method signatures change — the SQL and JSON serialization remain identical:

```typescript
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import type { FieldMappings } from './types.js'

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

  get(url: string, schemaHash: string): FieldMappings | null {
    const row = this.db
      .prepare('SELECT selectors FROM selector_cache WHERE url = ? AND schema_hash = ?')
      .get(url, schemaHash) as { selectors: string } | undefined

    return row ? JSON.parse(row.selectors) : null
  }

  set(url: string, schemaHash: string, fieldMappings: FieldMappings): void {
    this.db
      .prepare(
        `INSERT INTO selector_cache (url, schema_hash, selectors, last_success_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(url, schema_hash)
         DO UPDATE SET selectors = excluded.selectors,
                       last_success_at = excluded.last_success_at,
                       consecutive_failures = 0`
      )
      .run(url, schemaHash, JSON.stringify(fieldMappings))
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

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/cache.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cache.ts src/__tests__/cache.test.ts
git commit -m "feat: update SelectorCache to use FieldMappings type"
```

---

### Task 6: Update scraper orchestration and schema hash

**Files:**
- Modify: `src/scraper.ts`
- Modify: `src/__tests__/scraper.test.ts`

**Step 1: Write the failing tests**

Replace the full content of `src/__tests__/scraper.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { LanguageModel } from 'ai'
import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { FieldMappings } from '../types.js'

vi.mock('../fetcher.js', () => ({
  fetchAndClean: vi.fn(),
}))

vi.mock('../llm.js', () => ({
  generateFieldMappings: vi.fn(),
  fixFieldMappings: vi.fn(),
}))

import { fetchAndClean } from '../fetcher.js'
import { generateFieldMappings, fixFieldMappings } from '../llm.js'
import { Scraper } from '../scraper.js'
import { ExtractionFailed, PermanentFailure } from '../exceptions.js'

const mockFetch = vi.mocked(fetchAndClean)
const mockGenerate = vi.mocked(generateFieldMappings)
const mockFix = vi.mocked(fixFieldMappings)

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

  it('generates field mappings, extracts and transforms data, returns typed result', async () => {
    mockFetch.mockResolvedValueOnce(PRODUCT_HTML)
    mockGenerate.mockResolvedValueOnce(goodMappings)

    const result = await scraper.scrape({ url: 'https://example.com/product', schema })

    expect(result).toEqual({ title: 'Widget', price: 29.99, inStock: true })
    expect(mockGenerate).toHaveBeenCalledOnce()
  })

  it('uses cached field mappings on second call (no LLM)', async () => {
    mockFetch.mockResolvedValue(PRODUCT_HTML)
    mockGenerate.mockResolvedValueOnce(goodMappings)

    await scraper.scrape({ url: 'https://example.com/product', schema })
    const result = await scraper.scrape({ url: 'https://example.com/product', schema })

    expect(result).toEqual({ title: 'Widget', price: 29.99, inStock: true })
    expect(mockGenerate).toHaveBeenCalledOnce() // NOT called again
  })

  it('heals field mappings when validation fails then retry works', async () => {
    mockFetch.mockResolvedValueOnce(PRODUCT_HTML)
    const badMappings: FieldMappings = {
      title: { selector: 'h1', transform: 'value.trim()' },
      price: { selector: '.nonexistent', transform: 'parseFloat(value)' },
      inStock: { selector: '#stock', transform: "value.toLowerCase().includes('in stock')" },
    }
    mockGenerate.mockResolvedValueOnce(badMappings)
    mockFix.mockResolvedValueOnce(goodMappings)

    const result = await scraper.scrape({ url: 'https://example.com/product', schema })

    expect(result).toEqual({ title: 'Widget', price: 29.99, inStock: true })
    expect(mockFix).toHaveBeenCalledOnce()
  })

  it('throws ExtractionFailed when healing also fails', async () => {
    mockFetch.mockResolvedValueOnce(PRODUCT_HTML)
    const badMappings: FieldMappings = {
      title: { selector: 'h1', transform: 'value.trim()' },
      price: { selector: '.nonexistent', transform: 'parseFloat(value)' },
      inStock: { selector: '#stock', transform: "value.toLowerCase().includes('in stock')" },
    }
    mockGenerate.mockResolvedValueOnce(badMappings)
    mockFix.mockResolvedValueOnce({
      title: { selector: 'h1', transform: 'value.trim()' },
      price: { selector: '.still-nonexistent', transform: 'parseFloat(value)' },
      inStock: { selector: '#stock', transform: "value.toLowerCase().includes('in stock')" },
    })

    await expect(
      scraper.scrape({ url: 'https://example.com/product', schema }),
    ).rejects.toThrow(ExtractionFailed)
  })

  it('throws PermanentFailure after 4+ consecutive failures', async () => {
    mockFetch.mockResolvedValue(PRODUCT_HTML)
    const badMappings: FieldMappings = {
      title: { selector: 'h1', transform: 'value.trim()' },
      price: { selector: '.nonexistent', transform: 'parseFloat(value)' },
      inStock: { selector: '#stock', transform: "value.toLowerCase().includes('in stock')" },
    }
    mockGenerate.mockResolvedValue(badMappings)
    mockFix.mockResolvedValue({
      title: { selector: 'h1', transform: 'value.trim()' },
      price: { selector: '.still-nonexistent', transform: 'parseFloat(value)' },
      inStock: { selector: '#stock', transform: "value.toLowerCase().includes('in stock')" },
    })

    for (let i = 0; i < 4; i++) {
      await scraper.scrape({ url: 'https://example.com/product', schema }).catch(() => {})
    }

    await expect(
      scraper.scrape({ url: 'https://example.com/product', schema }),
    ).rejects.toThrow(PermanentFailure)
  })

  it('invalidates cache when schema description changes', async () => {
    mockFetch.mockResolvedValue(PRODUCT_HTML)
    mockGenerate.mockResolvedValue(goodMappings)

    const schema1 = z.object({
      title: z.string(),
      price: z.number().describe('strip dollar sign'),
      inStock: z.boolean(),
    })
    const schema2 = z.object({
      title: z.string(),
      price: z.number().describe('remove currency symbol'),
      inStock: z.boolean(),
    })

    await scraper.scrape({ url: 'https://example.com/product', schema: schema1 })
    await scraper.scrape({ url: 'https://example.com/product', schema: schema2 })

    // Should have called generate twice — different descriptions = different hash
    expect(mockGenerate).toHaveBeenCalledTimes(2)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/scraper.test.ts`
Expected: FAIL — imports `generateFieldMappings`/`fixFieldMappings` which don't match mock, and `scraper.ts` still references old functions

**Step 3: Implement the updated scraper.ts**

Replace the full content of `src/scraper.ts`:

```typescript
import crypto from 'node:crypto'
import { type LanguageModel } from 'ai'
import { type ZodObject, type ZodRawShape } from 'zod'
import type { FieldMappings } from './types.js'
import { type FieldInfo } from './prompts.js'
import { SelectorCache } from './cache.js'
import { fetchAndClean } from './fetcher.js'
import { generateFieldMappings, fixFieldMappings } from './llm.js'
import { runSelectors } from './selector.js'
import { validate } from './validator.js'
import { ExtractionFailed, PermanentFailure } from './exceptions.js'

const MAX_CONSECUTIVE_FAILURES = 3

export interface ScraperConfig {
  model: LanguageModel
  cachePath?: string
}

interface ScrapeOptions<T extends ZodRawShape> {
  url: string
  schema: ZodObject<T>
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
  const content = JSON.stringify(fields, Object.keys(fields).sort())
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
}

export class Scraper {
  private cache: SelectorCache
  private model: LanguageModel

  constructor(config: ScraperConfig) {
    this.cache = new SelectorCache(config.cachePath)
    this.model = config.model
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

    // 2. Check cache for field mappings
    let fieldMappings = this.cache.get(url, schemaHash)

    // 3. Generate field mappings if no cache
    if (!fieldMappings) {
      const fieldInfos = extractFieldInfo(schema as unknown as ZodObject<ZodRawShape>)
      fieldMappings = await generateFieldMappings(cleanedHtml, fieldInfos, this.model)
      this.cache.set(url, schemaHash, fieldMappings)
    }

    // 4. Run selectors with transforms
    const rawData = runSelectors(cleanedHtml, fieldMappings)

    // 5. Validate
    const result = validate(schema, rawData)

    if (result.success) {
      this.cache.set(url, schemaHash, fieldMappings)
      this.cache.resetFailures(url, schemaHash)
      return result.data
    }

    // 6. Healing attempt
    const fixedMappings = await fixFieldMappings(
      cleanedHtml,
      fieldMappings,
      result.errors,
      result.rawData,
      this.model,
    )
    const retryRawData = runSelectors(cleanedHtml, fixedMappings)
    const retryResult = validate(schema, retryRawData)

    if (retryResult.success) {
      this.cache.set(url, schemaHash, fixedMappings)
      this.cache.resetFailures(url, schemaHash)
      return retryResult.data
    }

    // 7. Failure
    this.cache.incrementFailures(url, schemaHash)
    throw new ExtractionFailed({
      url,
      errors: retryResult.errors,
      rawData: retryResult.rawData,
      fieldMappings: fixedMappings,
    })
  }

  close(): void {
    this.cache.close()
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/scraper.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/scraper.ts src/__tests__/scraper.test.ts
git commit -m "feat: update scraper to use field mappings with transforms and include descriptions in schema hash"
```

---

### Task 7: Update public exports and run full test suite

**Files:**
- Modify: `src/index.ts`

**Step 1: Update index.ts to export FieldMapping types**

Update `src/index.ts`:

```typescript
export { Scraper, type ScraperConfig } from './scraper.js'
export { ExtractionFailed, PermanentFailure } from './exceptions.js'
export type { FieldMapping, FieldMappings } from './types.js'
```

**Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: All tests PASS

**Step 3: Build to verify no type errors**

Run: `npm run build`
Expected: Clean build with no errors

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: export FieldMapping and FieldMappings types"
```

---

### Task 8: Update CLAUDE.md to reflect new architecture

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update the architecture section**

Update the relevant parts of `CLAUDE.md`:
- Change "generate selectors" → "generate field mappings (selector + transform)" in the pipeline diagram
- Update the Key Modules table to reflect renamed functions
- Update the Selector Value Extraction Logic section to mention transforms
- Add a note about `FieldMappings` type in Key Design Decisions

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md to reflect transform generation architecture"
```
