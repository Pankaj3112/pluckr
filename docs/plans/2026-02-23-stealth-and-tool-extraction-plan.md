# Stealth Fetching + Tool-Based LLM Extraction — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace bare Playwright with playwright-ghost for stealth fetching, and replace blind `generateObject` with an agentic `generateText` + tools loop so the LLM can verify selectors before committing.

**Architecture:** Two independent changes. (1) Swap `playwright` import for `playwright-ghost` with `plugins.recommended()` in `fetcher.ts`. (2) Rewrite `llm.ts` to use `generateText` + `tool()` from the Vercel AI SDK, giving the AI `testSelector`, `submitResult`, and `reportNoData` tools. The scraper orchestrator (`scraper.ts`) gets a new `ScrapeResult<T>` discriminated union return type and delegates all extraction/healing to the tool loop.

**Tech Stack:** playwright-ghost, Vercel AI SDK (`ai` v4: `generateText`, `tool`, `stepCountIs`), Zod, cheerio, better-sqlite3, vitest

**Design doc:** `docs/plans/2026-02-23-stealth-and-tool-extraction-design.md`

---

### Task 1: Install playwright-ghost and update fetcher

**Files:**
- Modify: `package.json` (add dependency)
- Modify: `src/fetcher.ts:1-2,48-58` (swap imports + launch config)
- Test: `src/__tests__/fetcher.test.ts` (existing tests still pass — they only test `cleanHtml`, not `fetchAndClean`)

**Step 1: Install playwright-ghost**

Run: `npm install playwright-ghost`

**Step 2: Update fetcher.ts imports and launch**

Replace the top of `src/fetcher.ts`:

```typescript
// Before:
import { chromium } from 'playwright'

// After:
import { chromium } from 'playwright-ghost'
import plugins from 'playwright-ghost/plugins'
```

Replace the `fetchAndClean` function:

```typescript
export async function fetchAndClean(url: string): Promise<string> {
  const browser = await chromium.launch({
    plugins: plugins.recommended(),
  })
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

**Step 3: Run existing fetcher tests**

Run: `npx vitest run src/__tests__/fetcher.test.ts`
Expected: All `cleanHtml` tests PASS (they don't touch Playwright)

**Step 4: Commit**

```bash
git add package.json package-lock.json src/fetcher.ts
git commit -m "feat: replace playwright with playwright-ghost for stealth fetching"
```

---

### Task 2: Add new types (ScrapeResult, ScrapeError)

**Files:**
- Modify: `src/types.ts` (add ScrapeResult and ScrapeError)

**Step 1: Write the failing test**

Create test in `src/__tests__/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type { ScrapeResult, ScrapeError } from '../types.js'

describe('ScrapeResult type', () => {
  it('narrows to success branch', () => {
    const result: ScrapeResult<{ title: string }> = {
      success: true,
      data: { title: 'Widget' },
    }
    if (result.success) {
      expect(result.data.title).toBe('Widget')
    }
  })

  it('narrows to error branch', () => {
    const result: ScrapeResult<{ title: string }> = {
      success: false,
      error: {
        code: 'NO_DATA',
        message: 'Page does not contain product data',
      },
    }
    if (!result.success) {
      expect(result.error.code).toBe('NO_DATA')
      expect(result.error.message).toContain('product data')
    }
  })

  it('error branch supports partialData', () => {
    const result: ScrapeResult<{ title: string; price: number }> = {
      success: false,
      error: {
        code: 'EXTRACTION_FAILED',
        message: 'Could not extract price',
        partialData: { title: 'Widget' },
      },
    }
    if (!result.success) {
      expect(result.error.partialData).toEqual({ title: 'Widget' })
    }
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/types.test.ts`
Expected: FAIL — `ScrapeResult` and `ScrapeError` don't exist yet

**Step 3: Add types to types.ts**

Append to `src/types.ts`:

```typescript
export interface ScrapeError {
  code: 'NO_DATA' | 'EXTRACTION_FAILED' | 'FETCH_FAILED' | 'PERMANENT_FAILURE'
  message: string
  partialData?: Record<string, unknown>
}

export type ScrapeResult<T> =
  | { success: true; data: T }
  | { success: false; error: ScrapeError }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/types.ts src/__tests__/types.test.ts
git commit -m "feat: add ScrapeResult and ScrapeError discriminated union types"
```

---

### Task 3: Add `testSingleSelector` helper to selector.ts

The `testSelector` tool needs a function to run a single selector against HTML and return structured results. Currently `runSelectors` runs all fields at once with no error info.

**Files:**
- Modify: `src/selector.ts` (add `testSingleSelector` function)
- Test: `src/__tests__/selector.test.ts` (add tests for the new function)

**Step 1: Write the failing tests**

Append to `src/__tests__/selector.test.ts`:

```typescript
import { testSingleSelector } from '../selector.js'

describe('testSingleSelector', () => {
  it('returns found with raw and transformed values', () => {
    const result = testSingleSelector(HTML, {
      selector: 'h1.product-title',
      transform: 'value.trim()',
    })
    expect(result).toEqual({
      found: true,
      rawValue: 'Widget Pro',
      transformedValue: 'Widget Pro',
    })
  })

  it('returns found with attribute extraction', () => {
    const result = testSingleSelector(HTML, {
      selector: '.rating',
      attribute: 'aria-label',
      transform: 'parseFloat(value)',
    })
    expect(result).toEqual({
      found: true,
      rawValue: '4.5 out of 5',
      transformedValue: 4.5,
    })
  })

  it('returns not found for missing selector', () => {
    const result = testSingleSelector(HTML, {
      selector: '.nonexistent',
      transform: 'value.trim()',
    })
    expect(result).toEqual({
      found: false,
      error: 'No element matched selector: .nonexistent',
    })
  })

  it('returns error when transform fails', () => {
    const result = testSingleSelector(HTML, {
      selector: 'h1.product-title',
      transform: 'value.nonExistentMethod()',
    })
    expect(result.found).toBe(false)
    expect('error' in result && result.error).toContain('Transform failed')
  })

  it('returns not found when element has no text content', () => {
    const emptyHtml = '<html><body><span class="empty"></span></body></html>'
    const result = testSingleSelector(emptyHtml, {
      selector: '.empty',
      transform: 'value.trim()',
    })
    expect(result).toEqual({
      found: false,
      error: 'Element matched but extracted value is empty',
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/selector.test.ts`
Expected: FAIL — `testSingleSelector` doesn't exist yet

**Step 3: Implement testSingleSelector**

Add to `src/selector.ts`:

```typescript
export type TestSelectorResult =
  | { found: true; rawValue: string; transformedValue: unknown }
  | { found: false; error: string }

export function testSingleSelector(
  html: string,
  params: { selector: string; attribute?: string; transform?: string },
): TestSelectorResult {
  const $ = cheerio.load(html)
  const el = $(params.selector).first()

  if (el.length === 0) {
    return { found: false, error: `No element matched selector: ${params.selector}` }
  }

  const rawValue = extractRawValue(el, params.attribute)
  if (rawValue === null || rawValue === '') {
    return { found: false, error: 'Element matched but extracted value is empty' }
  }

  if (!params.transform) {
    return { found: true, rawValue, transformedValue: rawValue }
  }

  try {
    const fn = new Function('value', `return ${params.transform}`)
    const transformedValue = fn(rawValue)
    return { found: true, rawValue, transformedValue }
  } catch (err) {
    return { found: false, error: `Transform failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}
```

**Step 4: Run all selector tests**

Run: `npx vitest run src/__tests__/selector.test.ts`
Expected: All tests PASS (both old and new)

**Step 5: Commit**

```bash
git add src/selector.ts src/__tests__/selector.test.ts
git commit -m "feat: add testSingleSelector helper for tool-based extraction"
```

---

### Task 4: Update prompts for tool-based extraction

**Files:**
- Modify: `src/prompts.ts` (replace system prompts with tool-aware versions, remove old prompt functions)

**Step 1: Write the failing test**

Create `src/__tests__/prompts.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionPrompt,
  buildCachedHintPrompt,
  type FieldInfo,
} from '../prompts.js'

describe('EXTRACTION_SYSTEM_PROMPT', () => {
  it('mentions testSelector tool', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('testSelector')
  })

  it('mentions submitResult tool', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('submitResult')
  })

  it('mentions reportNoData tool', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('reportNoData')
  })
})

describe('buildExtractionPrompt', () => {
  it('includes HTML and field list', () => {
    const html = '<html><body><h1>Test</h1></body></html>'
    const fields: FieldInfo[] = [
      { name: 'title', type: 'ZodString' },
      { name: 'price', type: 'ZodNumber', description: 'strip currency' },
    ]
    const result = buildExtractionPrompt(html, fields)

    expect(result).toContain('<html>')
    expect(result).toContain('Test')
    expect(result).toContain('"title"')
    expect(result).toContain('ZodString')
    expect(result).toContain('"price"')
    expect(result).toContain('strip currency')
  })
})

describe('buildCachedHintPrompt', () => {
  it('includes HTML, fields, and cached mappings', () => {
    const html = '<html><body><h1>Test</h1></body></html>'
    const fields: FieldInfo[] = [{ name: 'title', type: 'ZodString' }]
    const cached = { title: { selector: 'h1', transform: 'value.trim()' } }
    const result = buildCachedHintPrompt(html, fields, cached)

    expect(result).toContain('previously worked')
    expect(result).toContain('h1')
    expect(result).toContain('value.trim()')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/prompts.test.ts`
Expected: FAIL — new exports don't exist

**Step 3: Rewrite prompts.ts**

Replace `src/prompts.ts` entirely:

```typescript
export interface FieldInfo {
  name: string
  type: string
  description?: string
}

export const EXTRACTION_SYSTEM_PROMPT = `You are an expert web scraper. You have tools to test CSS selectors against a page and submit your final extraction result.

Workflow:
1. Analyze the HTML to find elements containing the requested data fields.
2. Use the testSelector tool to verify your candidate selectors work and extract the right values.
3. Once confident, use submitResult to submit all field mappings at once.
4. If submitResult reports validation errors, analyze them, use testSelector to try corrected selectors/transforms, then submitResult again.
5. If the page genuinely does not contain the requested data, use reportNoData.

Rules for selectors:
- Prefer stable attributes: id, data-*, aria-label over class names
- Prefer semantic elements (h1, main, article) over generic divs
- Each selector should match exactly one element
- Do not use overly specific selectors that break on minor HTML changes

Rules for value extraction:
- By default, text content is extracted
- Set attribute if you need an HTML attribute (href, src, value, alt, etc.)

Rules for transforms:
- Each transform is a JavaScript expression receiving variable \`value\` (string) returning the correctly typed result
- For number fields: parseFloat(value.replace(/[^0-9.-]/g, ''))
- For boolean fields: Boolean(value.trim()) or a condition like value.includes('...')
- For string fields: value.trim()
- If a field has a description/instruction, follow it for the transform`

function formatFieldList(fields: FieldInfo[]): string {
  return fields
    .map((f) => {
      if (f.description) {
        return `- "${f.name}" (type: ${f.type}, instruction: "${f.description}")`
      }
      return `- "${f.name}" (type: ${f.type})`
    })
    .join('\n')
}

export function buildExtractionPrompt(
  html: string,
  fields: FieldInfo[],
): string {
  return `Here is the cleaned HTML of a web page:

<html>
${html}
</html>

I need to extract the following fields:
${formatFieldList(fields)}

Use testSelector to verify your selectors work, then submitResult with the complete field mappings. If the page does not contain this data, use reportNoData.`
}

export function buildCachedHintPrompt(
  html: string,
  fields: FieldInfo[],
  cachedMappings: Record<string, { selector: string; transform: string; attribute?: string }>,
): string {
  return `Here is the cleaned HTML of a web page:

<html>
${html}
</html>

I need to extract the following fields:
${formatFieldList(fields)}

These field mappings previously worked but may be stale:
${JSON.stringify(cachedMappings, null, 2)}

Test the cached selectors first with testSelector. If they still work, submit them. If not, find corrected selectors and submit those.`
}
```

**Step 4: Run prompts tests**

Run: `npx vitest run src/__tests__/prompts.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/prompts.ts src/__tests__/prompts.test.ts
git commit -m "feat: rewrite prompts for tool-based extraction workflow"
```

---

### Task 5: Rewrite llm.ts with tool-based extraction

This is the core change. Replace `generateObject` with `generateText` + tools.

**Files:**
- Modify: `src/llm.ts` (full rewrite)
- Rewrite: `src/__tests__/llm.test.ts`

**Step 1: Write the failing tests**

Replace `src/__tests__/llm.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LanguageModel } from 'ai'
import type { FieldInfo } from '../prompts.js'
import { extractWithTools, type ExtractionResult } from '../llm.js'
import { z } from 'zod'

// Mock the 'ai' module
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    generateText: vi.fn(),
  }
})

import { generateText } from 'ai'

const mockGenerateText = vi.mocked(generateText)
const fakeModel = { modelId: 'test-model' } as LanguageModel

const html = '<html><body><h1>Product</h1><span class="price">$10</span></body></html>'
const schema = z.object({
  title: z.string(),
  price: z.number(),
})
const fields: FieldInfo[] = [
  { name: 'title', type: 'ZodString' },
  { name: 'price', type: 'ZodNumber' },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('extractWithTools', () => {
  it('returns success when AI submits valid mappings', async () => {
    // Simulate: AI calls submitResult with good mappings
    mockGenerateText.mockResolvedValueOnce({
      text: '',
      steps: [
        {
          toolCalls: [{
            toolName: 'submitResult',
            args: {
              mappings: {
                title: { selector: 'h1', transform: 'value.trim()' },
                price: { selector: '.price', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
              },
            },
          }],
          toolResults: [{
            toolName: 'submitResult',
            result: { valid: true, data: { title: 'Product', price: 10 } },
          }],
        },
      ],
    } as any)

    const result = await extractWithTools({
      html,
      fields,
      schema,
      model: fakeModel,
      maxToolCalls: 3,
    })

    expect(result).toEqual({
      success: true,
      data: { title: 'Product', price: 10 },
      fieldMappings: {
        title: { selector: 'h1', transform: 'value.trim()' },
        price: { selector: '.price', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
      },
    })
  })

  it('returns no-data error when AI calls reportNoData', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: '',
      steps: [
        {
          toolCalls: [{
            toolName: 'reportNoData',
            args: { reason: 'Page is a login form, no product data' },
          }],
          toolResults: [{
            toolName: 'reportNoData',
            result: { reported: true },
          }],
        },
      ],
    } as any)

    const result = await extractWithTools({
      html,
      fields,
      schema,
      model: fakeModel,
      maxToolCalls: 3,
    })

    expect(result).toEqual({
      success: false,
      error: {
        code: 'NO_DATA',
        message: 'Page is a login form, no product data',
      },
    })
  })

  it('returns extraction-failed when tool loop exhausts without valid submit', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'I could not find the right selectors.',
      steps: [
        {
          toolCalls: [{
            toolName: 'testSelector',
            args: { selector: '.wrong', transform: 'value.trim()' },
          }],
          toolResults: [{
            toolName: 'testSelector',
            result: { found: false, error: 'No element matched selector: .wrong' },
          }],
        },
      ],
    } as any)

    const result = await extractWithTools({
      html,
      fields,
      schema,
      model: fakeModel,
      maxToolCalls: 3,
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('EXTRACTION_FAILED')
    }
  })

  it('passes maxToolCalls to stopWhen', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: '',
      steps: [],
    } as any)

    await extractWithTools({
      html,
      fields,
      schema,
      model: fakeModel,
      maxToolCalls: 7,
    })

    expect(mockGenerateText).toHaveBeenCalledOnce()
    const callArgs = mockGenerateText.mock.calls[0][0] as any
    expect(callArgs.stopWhen).toBeDefined()
  })

  it('passes cached mappings as hint in prompt', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: '',
      steps: [
        {
          toolCalls: [{
            toolName: 'submitResult',
            args: {
              mappings: {
                title: { selector: 'h1', transform: 'value.trim()' },
                price: { selector: '.price', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
              },
            },
          }],
          toolResults: [{
            toolName: 'submitResult',
            result: { valid: true, data: { title: 'Product', price: 10 } },
          }],
        },
      ],
    } as any)

    const cachedMappings = {
      title: { selector: 'h1', transform: 'value.trim()' },
      price: { selector: '.old-price', transform: 'parseFloat(value)' },
    }

    await extractWithTools({
      html,
      fields,
      schema,
      model: fakeModel,
      maxToolCalls: 3,
      cachedMappings,
    })

    const callArgs = mockGenerateText.mock.calls[0][0] as any
    expect(callArgs.prompt).toContain('previously worked')
    expect(callArgs.prompt).toContain('.old-price')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/llm.test.ts`
Expected: FAIL — `extractWithTools` doesn't exist

**Step 3: Implement llm.ts**

Replace `src/llm.ts`:

```typescript
import { generateText, tool, stepCountIs, type LanguageModel } from 'ai'
import { z, type ZodObject, type ZodRawShape } from 'zod'
import type { FieldMappings, ScrapeError } from './types.js'
import { testSingleSelector } from './selector.js'
import { runSelectors } from './selector.js'
import { validate } from './validator.js'
import {
  type FieldInfo,
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionPrompt,
  buildCachedHintPrompt,
} from './prompts.js'

export type ExtractionResult<T> =
  | { success: true; data: T; fieldMappings: FieldMappings }
  | { success: false; error: ScrapeError }

interface ExtractWithToolsOptions<T extends ZodRawShape> {
  html: string
  fields: FieldInfo[]
  schema: ZodObject<T>
  model: LanguageModel
  maxToolCalls: number
  cachedMappings?: FieldMappings
  debug?: boolean
}

export async function extractWithTools<T extends ZodRawShape>(
  options: ExtractWithToolsOptions<T>,
): Promise<ExtractionResult<ReturnType<ZodObject<T>['parse']>>> {
  const { html, fields, schema, model, maxToolCalls, cachedMappings, debug } = options

  // Track results from tool calls
  let finalResult: ExtractionResult<ReturnType<ZodObject<T>['parse']>> | null = null

  const prompt = cachedMappings
    ? buildCachedHintPrompt(html, fields, cachedMappings)
    : buildExtractionPrompt(html, fields)

  await generateText({
    model,
    system: EXTRACTION_SYSTEM_PROMPT,
    prompt,
    stopWhen: stepCountIs(maxToolCalls),
    tools: {
      testSelector: tool({
        description: 'Test a CSS selector against the page HTML. Returns the extracted raw value and optionally the transformed value. Use this to verify selectors before submitting.',
        inputSchema: z.object({
          selector: z.string().describe('CSS selector to test'),
          attribute: z.string().optional().describe('HTML attribute to extract (e.g. "href", "src"). Omit for text content.'),
          transform: z.string().optional().describe('JavaScript expression receiving `value` (string) to transform the raw value'),
        }),
        execute: async (params) => {
          const result = testSingleSelector(html, params)
          if (debug) {
            console.log('[debug] testSelector:', params.selector, '->', JSON.stringify(result))
          }
          return result
        },
      }),

      submitResult: tool({
        description: 'Submit the final field mappings for all fields. The system will run them against the HTML, validate against the schema, and return success or validation errors. Call this when you are confident in your selectors.',
        inputSchema: z.object({
          mappings: z.record(z.string(), z.object({
            selector: z.string(),
            transform: z.string(),
            attribute: z.string().optional(),
          })).describe('Map of field name to { selector, transform, attribute? }'),
        }),
        execute: async ({ mappings }) => {
          const rawData = runSelectors(html, mappings)
          const validationResult = validate(schema, rawData)

          if (debug) {
            console.log('[debug] submitResult rawData:', JSON.stringify(rawData))
            console.log('[debug] submitResult valid:', validationResult.success)
          }

          if (validationResult.success) {
            finalResult = {
              success: true,
              data: validationResult.data,
              fieldMappings: mappings,
            }
            return { valid: true, data: validationResult.data }
          }

          return {
            valid: false,
            errors: validationResult.errors,
            extractedData: rawData,
          }
        },
      }),

      reportNoData: tool({
        description: 'Report that the page does not contain the requested data. Use this only when you are certain the data is not present on the page.',
        inputSchema: z.object({
          reason: z.string().describe('Explanation of why the data is not present'),
        }),
        execute: async ({ reason }) => {
          finalResult = {
            success: false,
            error: {
              code: 'NO_DATA',
              message: reason,
            },
          }
          return { reported: true }
        },
      }),
    },
  })

  // If the AI submitted a valid result or reported no data, return it
  if (finalResult) {
    return finalResult
  }

  // Tool loop exhausted without a valid submission
  return {
    success: false,
    error: {
      code: 'EXTRACTION_FAILED',
      message: 'Tool loop exhausted without successful extraction',
    },
  }
}
```

**Step 4: Run llm tests**

Run: `npx vitest run src/__tests__/llm.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/llm.ts src/__tests__/llm.test.ts
git commit -m "feat: rewrite LLM layer with tool-based extraction using generateText + tools"
```

---

### Task 6: Rewrite scraper.ts with new return type and tool loop

**Files:**
- Modify: `src/scraper.ts` (new return type, delegate to `extractWithTools`)
- Rewrite: `src/__tests__/scraper.test.ts`

**Step 1: Write the failing tests**

Replace `src/__tests__/scraper.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { LanguageModel } from 'ai'
import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { FieldMappings, ScrapeResult } from '../types.js'

vi.mock('../fetcher.js', () => ({
  fetchAndClean: vi.fn(),
}))

vi.mock('../llm.js', () => ({
  extractWithTools: vi.fn(),
}))

import { fetchAndClean } from '../fetcher.js'
import { extractWithTools } from '../llm.js'
import { Scraper } from '../scraper.js'

const mockFetch = vi.mocked(fetchAndClean)
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
    mockFetch.mockResolvedValueOnce(PRODUCT_HTML)
    mockExtract.mockResolvedValueOnce({
      success: true,
      data: { title: 'Widget', price: 29.99, inStock: true },
      fieldMappings: goodMappings,
    })

    const result = await scraper.scrape({ url: 'https://example.com/product', schema })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ title: 'Widget', price: 29.99, inStock: true })
    }
  })

  it('uses cached field mappings on second call (no LLM)', async () => {
    mockFetch.mockResolvedValue(PRODUCT_HTML)
    mockExtract.mockResolvedValueOnce({
      success: true,
      data: { title: 'Widget', price: 29.99, inStock: true },
      fieldMappings: goodMappings,
    })

    await scraper.scrape({ url: 'https://example.com/product', schema })
    const result = await scraper.scrape({ url: 'https://example.com/product', schema })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ title: 'Widget', price: 29.99, inStock: true })
    }
    // extractWithTools should only be called once — second call uses cache
    expect(mockExtract).toHaveBeenCalledOnce()
  })

  it('returns NO_DATA error when AI reports no data', async () => {
    mockFetch.mockResolvedValueOnce(PRODUCT_HTML)
    mockExtract.mockResolvedValueOnce({
      success: false,
      error: { code: 'NO_DATA', message: 'Page is a login form' },
    })

    const result = await scraper.scrape({ url: 'https://example.com/product', schema })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('NO_DATA')
    }
  })

  it('returns EXTRACTION_FAILED when tool loop exhausts', async () => {
    mockFetch.mockResolvedValueOnce(PRODUCT_HTML)
    mockExtract.mockResolvedValueOnce({
      success: false,
      error: { code: 'EXTRACTION_FAILED', message: 'Could not extract' },
    })

    const result = await scraper.scrape({ url: 'https://example.com/product', schema })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('EXTRACTION_FAILED')
    }
  })

  it('returns PERMANENT_FAILURE after too many consecutive failures', async () => {
    mockFetch.mockResolvedValue(PRODUCT_HTML)
    mockExtract.mockResolvedValue({
      success: false,
      error: { code: 'EXTRACTION_FAILED', message: 'Failed' },
    })

    // Exhaust consecutive failure count
    for (let i = 0; i < 4; i++) {
      await scraper.scrape({ url: 'https://example.com/product', schema })
    }

    const result = await scraper.scrape({ url: 'https://example.com/product', schema })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('PERMANENT_FAILURE')
    }
    // Should NOT have called fetch or extract on the 5th attempt
    expect(mockFetch).toHaveBeenCalledTimes(4)
    expect(mockExtract).toHaveBeenCalledTimes(4)
  })

  it('returns FETCH_FAILED when page fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('net::ERR_CONNECTION_REFUSED'))

    const result = await scraper.scrape({ url: 'https://example.com/product', schema })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('FETCH_FAILED')
      expect(result.error.message).toContain('ERR_CONNECTION_REFUSED')
    }
  })

  it('re-runs tool loop with cached hint when cache hit fails validation', async () => {
    mockFetch.mockResolvedValue(PRODUCT_HTML)

    // First call: succeeds and caches
    mockExtract.mockResolvedValueOnce({
      success: true,
      data: { title: 'Widget', price: 29.99, inStock: true },
      fieldMappings: goodMappings,
    })
    await scraper.scrape({ url: 'https://example.com/product', schema })

    // Simulate page change — cached selectors fail, need tool loop with hint
    const changedHtml = '<html><body><h2>Widget v2</h2><div class="new-price">$39.99</div></body></html>'
    mockFetch.mockResolvedValueOnce(changedHtml)
    mockExtract.mockResolvedValueOnce({
      success: true,
      data: { title: 'Widget v2', price: 39.99, inStock: true },
      fieldMappings: {
        title: { selector: 'h2', transform: 'value.trim()' },
        price: { selector: '.new-price', transform: "parseFloat(value.replace(/[^0-9.]/g, ''))" },
        inStock: { selector: '#stock', transform: "value.toLowerCase().includes('in stock')" },
      },
    })

    const result = await scraper.scrape({ url: 'https://example.com/product', schema })

    // extractWithTools should have been called with cachedMappings
    expect(mockExtract).toHaveBeenCalledTimes(2)
    const secondCallArgs = mockExtract.mock.calls[1][0] as any
    expect(secondCallArgs.cachedMappings).toBeDefined()
  })

  it('passes maxToolCalls from config', async () => {
    const customScraper = new Scraper({
      model: fakeModel,
      cachePath: path.join(tmpDir, 'cache2.db'),
      maxToolCalls: 7,
    })

    mockFetch.mockResolvedValueOnce(PRODUCT_HTML)
    mockExtract.mockResolvedValueOnce({
      success: true,
      data: { title: 'Widget', price: 29.99, inStock: true },
      fieldMappings: goodMappings,
    })

    await customScraper.scrape({ url: 'https://example.com/product', schema })

    const callArgs = mockExtract.mock.calls[0][0] as any
    expect(callArgs.maxToolCalls).toBe(7)

    customScraper.close()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/scraper.test.ts`
Expected: FAIL — scraper still uses old API

**Step 3: Rewrite scraper.ts**

Replace `src/scraper.ts`:

```typescript
import crypto from 'node:crypto'
import { type LanguageModel } from 'ai'
import { type ZodObject, type ZodRawShape } from 'zod'
import type { FieldMappings, ScrapeResult } from './types.js'
import { type FieldInfo } from './prompts.js'
import { SelectorCache } from './cache.js'
import { fetchAndClean } from './fetcher.js'
import { extractWithTools } from './llm.js'
import { runSelectors } from './selector.js'
import { validate } from './validator.js'

const MAX_CONSECUTIVE_FAILURES = 3
const DEFAULT_MAX_TOOL_CALLS = 3

export interface ScraperConfig {
  model: LanguageModel
  cachePath?: string
  debug?: boolean
  maxToolCalls?: number
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
  private maxToolCalls: number

  constructor(config: ScraperConfig) {
    this.cache = new SelectorCache(config.cachePath)
    this.model = config.model
    this.debug = config.debug ?? false
    this.maxToolCalls = config.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS
  }

  async scrape<T extends ZodRawShape>(
    options: ScrapeOptions<T>,
  ): Promise<ScrapeResult<ReturnType<ZodObject<T>['parse']>>> {
    const { url, schema } = options
    const schemaHash = computeSchemaHash(schema as unknown as ZodObject<ZodRawShape>)

    // Guard: check for permanent failure
    const failureCount = this.cache.getFailureCount(url, schemaHash)
    if (failureCount > MAX_CONSECUTIVE_FAILURES) {
      return {
        success: false,
        error: {
          code: 'PERMANENT_FAILURE',
          message: `Scraping ${url} has failed ${failureCount} consecutive times. Clear the cache to retry.`,
        },
      }
    }

    // 1. Fetch and clean page
    let cleanedHtml: string
    try {
      cleanedHtml = await fetchAndClean(url)
    } catch (err) {
      return {
        success: false,
        error: {
          code: 'FETCH_FAILED',
          message: err instanceof Error ? err.message : String(err),
        },
      }
    }

    // 2. Check cache for field mappings
    const cachedMappings = this.cache.get(url, schemaHash)

    // 3. If cached, try running them directly first
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

    // 4. Run tool-based extraction
    const fieldInfos = extractFieldInfo(schema as unknown as ZodObject<ZodRawShape>)
    const extractionResult = await extractWithTools({
      html: cleanedHtml,
      fields: fieldInfos,
      schema: schema as unknown as ZodObject<ZodRawShape>,
      model: this.model,
      maxToolCalls: this.maxToolCalls,
      cachedMappings: cachedMappings ?? undefined,
      debug: this.debug,
    })

    if (extractionResult.success) {
      this.cache.set(url, schemaHash, extractionResult.fieldMappings)
      this.cache.resetFailures(url, schemaHash)
      return { success: true, data: extractionResult.data }
    }

    // Track failures for EXTRACTION_FAILED
    if (extractionResult.error.code === 'EXTRACTION_FAILED') {
      this.cache.incrementFailures(url, schemaHash)
    }

    return extractionResult
  }

  close(): void {
    this.cache.close()
  }
}
```

**Step 4: Run scraper tests**

Run: `npx vitest run src/__tests__/scraper.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/scraper.ts src/__tests__/scraper.test.ts
git commit -m "feat: rewrite scraper with ScrapeResult return type and tool-based extraction"
```

---

### Task 7: Update exports and clean up unused code

**Files:**
- Modify: `src/index.ts` (export new types)
- Modify: `src/exceptions.ts` (keep for backwards compat but mark deprecated)

**Step 1: Update index.ts**

Replace `src/index.ts`:

```typescript
export { Scraper, type ScraperConfig } from './scraper.js'
export { ExtractionFailed, PermanentFailure } from './exceptions.js'
export type { FieldMapping, FieldMappings, ScrapeResult, ScrapeError } from './types.js'
```

**Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: All tests PASS across all files

**Step 3: Build**

Run: `npm run build`
Expected: Clean build, no TypeScript errors

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: export ScrapeResult and ScrapeError types from package"
```

---

### Task 8: Update CLAUDE.md to reflect new architecture

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update architecture section**

Update the pipeline diagram to reflect:
- `playwright-ghost` instead of `playwright`
- `extractWithTools` instead of `generateFieldMappings` / `fixFieldMappings`
- `ScrapeResult` discriminated union instead of thrown exceptions
- `maxToolCalls` config

Update the module table:
- `llm.ts` — now exports `extractWithTools` (not `generateFieldMappings`/`fixFieldMappings`)
- `types.ts` — now includes `ScrapeResult`, `ScrapeError`
- `prompts.ts` — now exports `EXTRACTION_SYSTEM_PROMPT`, `buildExtractionPrompt`, `buildCachedHintPrompt`

Update "Key Design Decisions" to mention:
- Tool-based extraction with `generateText` + `testSelector`/`submitResult`/`reportNoData`
- Self-healing inside tool loop (no separate heal step)
- Discriminated union return type (no thrown exceptions)
- `playwright-ghost` for stealth

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for tool-based extraction and stealth fetching"
```

---

### Task 9: Final verification

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

**Step 2: Build**

Run: `npm run build`
Expected: Clean build

**Step 3: Verify exports**

Run: `node -e "const m = require('./dist/index.cjs'); console.log(Object.keys(m))"`
Expected: Should include `Scraper`, `ExtractionFailed`, `PermanentFailure`

---

## Task Dependency Graph

```
Task 1 (stealth fetcher) ─────────────────────────┐
Task 2 (types) ──────────────┐                     │
Task 3 (testSingleSelector) ─┤                     │
Task 4 (prompts) ────────────┼──▶ Task 5 (llm) ──▶ Task 6 (scraper) ──▶ Task 7 (exports) ──▶ Task 8 (docs) ──▶ Task 9 (verify)
                              │
(Tasks 1-4 can run in parallel)
```

Tasks 1, 2, 3, and 4 are independent and can be implemented in parallel. Task 5 depends on 2, 3, and 4. Task 6 depends on 5. Tasks 7-9 are sequential.
