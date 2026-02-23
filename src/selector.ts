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
