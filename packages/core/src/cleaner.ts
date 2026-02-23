import { load } from 'cheerio'

const REMOVE_TAGS = ['script', 'style', 'svg', 'noscript', 'iframe']
const HIDDEN_CLASSES = ['hidden', 'd-none', 'sr-only']
const ALLOWED_ATTRS = new Set([
  'id', 'class', 'aria-label', 'placeholder', 'alt', 'href', 'src', 'value',
])

function isAllowedAttr(name: string): boolean {
  return ALLOWED_ATTRS.has(name) || name.startsWith('data-')
}

export function cleanHtml(html: string): string {
  const $ = load(html)

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
