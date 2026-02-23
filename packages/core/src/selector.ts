import * as cheerio from 'cheerio'
import type { FieldMappings } from './types.js'

function extractRawValue(
  el: cheerio.Cheerio<cheerio.Element>,
  attribute?: string,
): string | null {
  // If the LLM specified an attribute, use it directly
  if (attribute) {
    return el.attr(attribute) ?? null
  }

  // Default: text content
  return el.text().trim() || null
}

export function runSelectors(
  html: string,
  fieldMappings: FieldMappings,
): Record<string, unknown> {
  const $ = cheerio.load(html)
  const results: Record<string, unknown> = {}

  for (const [field, { selector, transform, attribute }] of Object.entries(fieldMappings)) {
    const el = $(selector).first()

    if (el.length === 0) {
      results[field] = null
      continue
    }

    const rawValue = extractRawValue(el, attribute)
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
