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
