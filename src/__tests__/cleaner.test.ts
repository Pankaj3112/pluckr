import { describe, it, expect } from 'vitest'
import { cleanHtml } from '../cleaner.js'

describe('cleanHtml', () => {
  it('removes script tags', () => {
    const html = '<html><body><p>Hello</p><script>alert(1)</script></body></html>'
    const result = cleanHtml(html)
    expect(result).toContain('Hello')
    expect(result).not.toContain('script')
    expect(result).not.toContain('alert')
  })

  it('removes style, svg, noscript, iframe tags', () => {
    const html = `<html><body>
      <p>Content</p>
      <style>.x{color:red}</style>
      <svg><circle/></svg>
      <noscript>Enable JS</noscript>
      <iframe src="ad.html"></iframe>
    </body></html>`
    const result = cleanHtml(html)
    expect(result).toContain('Content')
    expect(result).not.toContain('style')
    expect(result).not.toContain('svg')
    expect(result).not.toContain('noscript')
    expect(result).not.toContain('iframe')
  })

  it('removes elements with inline display:none', () => {
    const html = '<html><body><p>Visible</p><p style="display:none">Hidden</p></body></html>'
    const result = cleanHtml(html)
    expect(result).toContain('Visible')
    expect(result).not.toContain('Hidden')
  })

  it('removes elements with inline visibility:hidden', () => {
    const html = '<html><body><p>Visible</p><p style="visibility: hidden">Hidden</p></body></html>'
    const result = cleanHtml(html)
    expect(result).toContain('Visible')
    expect(result).not.toContain('Hidden')
  })

  it('removes elements with hidden classes', () => {
    const html = `<html><body>
      <p>Visible</p>
      <p class="hidden">H1</p>
      <p class="d-none">H2</p>
      <p class="sr-only">H3</p>
    </body></html>`
    const result = cleanHtml(html)
    expect(result).toContain('Visible')
    expect(result).not.toContain('H1')
    expect(result).not.toContain('H2')
    expect(result).not.toContain('H3')
  })

  it('preserves allowed attributes and strips others', () => {
    const html = `<html><body>
      <div id="main" class="container" data-testid="box" onclick="hack()" style="color:red">
        <span aria-label="info" title="tooltip">Text</span>
        <input placeholder="Type here" tabindex="1" value="val" />
        <img alt="photo" width="100" src="img.jpg" />
        <a href="/page" target="_blank">Link</a>
      </div>
    </body></html>`
    const result = cleanHtml(html)

    // Allowed attributes preserved
    expect(result).toContain('id="main"')
    expect(result).toContain('class="container"')
    expect(result).toContain('data-testid="box"')
    expect(result).toContain('aria-label="info"')
    expect(result).toContain('placeholder="Type here"')
    expect(result).toContain('alt="photo"')
    expect(result).toContain('href="/page"')
    expect(result).toContain('src="img.jpg"')
    expect(result).toContain('value="val"')

    // Disallowed attributes stripped
    expect(result).not.toContain('onclick')
    expect(result).not.toContain('title=')
    expect(result).not.toContain('tabindex')
    expect(result).not.toContain('width=')
    expect(result).not.toContain('target=')
    // Note: style is stripped because it's not in the allowed list
    // (inline display:none elements are removed entirely before attribute stripping)
    expect(result).not.toContain('style=')
  })
})
