# LLM Transform Generation Design

**Date**: 2026-02-23
**Status**: Approved

## Overview

Extend the LLM selector generation to also produce a JavaScript transform expression per field. Transforms handle type conversion (replacing Zod coercion), allowing the LLM to generate context-aware conversions like stripping currency symbols or parsing booleans from natural language.

## Core Type

```typescript
interface FieldMapping {
  selector: string
  transform: string  // JS expression receiving `value` (string), e.g. "parseFloat(value.replace(/[^0-9.]/g, ''))"
}

type FieldMappings = Record<string, FieldMapping>
```

Replaces `Record<string, string>` throughout the pipeline.

## Pipeline

```
fetch → clean → extract schema metadata → LLM generates {selector, transform} per field
  → runSelectors extracts raw values + applies transforms → Zod validates (no coercion) → cache or heal
```

## Schema Metadata Extraction

New function in `scraper.ts`:

```typescript
interface FieldInfo {
  name: string
  type: string          // "ZodNumber", "ZodString", "ZodBoolean", etc.
  description?: string  // from z.number().describe("strip currency symbol")
}

function extractFieldInfo(schema: ZodObject<ZodRawShape>): FieldInfo[]
```

Unwraps coerce/optional/nullable wrappers to get the base Zod type name. Extracts `.description` from the field.

## Prompt Changes

### Generate prompt

Field list format changes from:
```
- "price" (expected type: string)
```
to:
```
- "price" (type: number, instruction: "strip currency symbol and parse as decimal")
- "title" (type: string)
```

System prompt addition:
```
For each field, provide:
1. A CSS selector targeting the element containing the value
2. A JavaScript transform expression that converts the raw extracted text
   to the correct type. The expression receives a variable `value` (string).

Transform guidelines:
- If the field has an instruction, follow it for the transform
- For number fields without instruction: parseFloat(value.replace(/[^0-9.-]/g, ''))
- For boolean fields without instruction: Boolean(value.trim())
- For string fields without instruction: value.trim()
```

### Response schema

```typescript
z.object({
  fieldName: z.object({
    selector: z.string(),
    transform: z.string(),
  })
})
```

### Fix prompt

Enhanced to include previous transforms alongside previous selectors. LLM can fix both bad selectors and bad transforms.

## Transform Execution

In `runSelectors` (`selector.ts`):

1. Extract raw string value (same element-type heuristics as today)
2. Apply transform: `new Function('value', 'return ' + transform)(rawValue)`
3. Return `Record<string, unknown>` (transforms produce typed values)

**Error handling**: If a transform throws, catch and set field to `null`. Zod validation surfaces it as a missing field error, and the heal step can fix the transform.

## Cache

Same `selectors` column, new JSON shape. Changes from `{"price": ".price"}` to `{"price": {"selector": ".price", "transform": "parseFloat(...)"}}`. Old cached entries become cache misses (triggers re-generation).

## Schema Hash

Include field descriptions in the hash alongside field names and types. Changing a description invalidates the cache, ensuring transforms are re-generated to match the new instruction.

## Module Changes

| Module | Change |
|--------|--------|
| `llm.ts` | `generateSelectors` → `generateFieldMappings`, `fixSelectors` → `fixFieldMappings`. Return `FieldMappings`. Response schema uses nested objects. |
| `prompts.ts` | Field list includes type + description. System prompt instructs on transform generation with defaults per type. Fix prompt includes previous transforms. |
| `selector.ts` | `runSelectors` accepts `FieldMappings`, applies transforms via `new Function`, returns `Record<string, unknown>`. Transform errors caught → null. |
| `scraper.ts` | `extractFieldInfo()` extracts type/description from Zod. Passes `FieldInfo[]` to LLM. Schema hash includes descriptions. |
| `cache.ts` | No code changes — same column, new JSON shape. Type annotations update. |
| `exceptions.ts` | `selectors` field → `fieldMappings: FieldMappings` on `ExtractionFailed`. |

## Key Decisions

- **Transforms replace Zod coercion**: Clean separation — LLM owns conversion, Zod owns validation
- **`new Function` execution**: Simple, fast. User controls the LLM so transform code is trusted
- **Transform errors → null**: Heal step fixes bad transforms via validation error feedback
- **Descriptions in schema hash**: Ensures cache invalidation when transform instructions change
- **Same cache column**: No migration needed. Old entries degrade gracefully to cache misses
