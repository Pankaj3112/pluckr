# Stealth Fetching + Tool-Based LLM Extraction

**Date:** 2026-02-23
**Status:** Approved
**Breaking:** Yes (v0.2.0)

## Problem

1. **403 errors:** Bare Playwright launch is trivially detected by anti-bot systems. No stealth measures, no user-agent rotation, no fingerprint masking.
2. **Blind extraction:** `generateObject` asks the LLM to produce CSS selectors in one shot without verifying them. If wrong, one heal retry. The LLM never tests its selectors before committing.

## Design

### 1. Stealth Fetching

Replace `playwright` with `playwright-ghost` in `fetcher.ts`. This is a drop-in replacement with identical API plus a `plugins` option.

```typescript
import { chromium } from 'playwright-ghost'
import plugins from 'playwright-ghost/plugins'

const browser = await chromium.launch({
  plugins: plugins.recommended(),
})
```

`plugins.recommended()` includes: polyfill.headless, polyfill.automation, polyfill.webdriver, polyfill.screen, polyfill.viewport. Passes 24+ bot detection tests including Cloudflare Turnstile.

**Dependency:** Add `playwright-ghost`, keep `playwright` as transitive.

### 2. Tool-Based LLM Extraction

Replace `generateObject` with `generateText` + tools from the Vercel AI SDK. The AI gets tools to iteratively test selectors and self-correct.

#### Tools

**`testSelector`**
- Input: `{ selector: string, attribute?: string, transform?: string }`
- Runs against cleaned HTML via cheerio
- Returns: `{ found: true, rawValue: string, transformedValue: unknown }` or `{ found: false, error: string }`

**`submitResult`**
- Input: `FieldMappings` object (all fields with selector + transform + attribute?)
- Runs all selectors, validates against Zod schema
- Returns: `{ valid: true, data }` or `{ valid: false, errors: string[], extractedData: Record<string, unknown> }`
- On valid: signals completion, breaks the tool loop

**`reportNoData`**
- Input: `{ reason: string }`
- AI calls this when the page doesn't contain the requested data
- Produces the error branch of the result type

#### Flow

```
generateText({
  model,
  tools: { testSelector, submitResult, reportNoData },
  stopWhen: stepCountIs(maxToolCalls),
  system: EXTRACTION_SYSTEM_PROMPT,
  prompt: html + field descriptions
})
```

Typical AI behavior:
1. Read HTML, identify candidate selectors
2. Call `testSelector` to verify a few candidates
3. Call `submitResult` with final mappings
4. If validation fails, see errors, test corrections, resubmit
5. If page has no data, call `reportNoData`

#### Healing is now internal

The separate `fixFieldMappings` step is removed. Self-correction happens inside the tool loop. The `stopWhen` limit (configurable via `maxToolCalls`) controls max iterations.

### 3. Return Type

```typescript
type ScrapeResult<T> =
  | { success: true; data: T }
  | { success: false; error: ScrapeError }

interface ScrapeError {
  code: 'NO_DATA' | 'EXTRACTION_FAILED' | 'FETCH_FAILED' | 'PERMANENT_FAILURE'
  message: string
  partialData?: Record<string, unknown>
}
```

`scrape()` no longer throws. Always returns `ScrapeResult`. This is a breaking change.

Error codes:
- `NO_DATA`: AI determined page doesn't contain requested data
- `EXTRACTION_FAILED`: Tool loop exhausted without valid extraction
- `FETCH_FAILED`: Page couldn't be loaded (network error, timeout)
- `PERMANENT_FAILURE`: Too many consecutive failures for this URL+schema

### 4. Config

```typescript
export interface ScraperConfig {
  model: LanguageModel
  cachePath?: string
  debug?: boolean
  maxToolCalls?: number  // default: 3
}
```

### 5. Cache Integration

- **Cache hit:** Skip tool loop, run cached selectors, validate, return
- **Cache miss:** Run full tool loop
- **Cache hit + validation fail:** Run tool loop with cached mappings as hint in prompt

### 6. Modules Affected

| Module | Change |
|--------|--------|
| `fetcher.ts` | Replace playwright with playwright-ghost |
| `llm.ts` | Rewrite: generateObject -> generateText + tools |
| `scraper.ts` | New return type, remove separate heal step, add maxToolCalls config |
| `types.ts` | Add ScrapeResult, ScrapeError types |
| `exceptions.ts` | Keep classes but they're no longer thrown by scrape() |
| `prompts.ts` | Update system prompts for tool-based approach |
| `selector.ts` | Add single-field test function for testSelector tool |
| `index.ts` | Export new types |
| `validator.ts` | No change |
| `cache.ts` | No change |

### 7. Testing

- Mock `generateText` instead of `generateObject`
- Test each tool independently (testSelector, submitResult, reportNoData)
- Test tool loop integration with simulated multi-step conversations
- Test stealth fetcher launch (mock playwright-ghost)
- Test all ScrapeResult branches
