import * as cheerio from 'cheerio'
import { chromium } from 'playwright-ghost'
import plugins from 'playwright-ghost/plugins'

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
