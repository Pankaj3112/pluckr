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
