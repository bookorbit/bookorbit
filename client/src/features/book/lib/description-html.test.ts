import { describe, expect, it } from 'vitest'
import { normalizeDescriptionHtml, sanitizeDescriptionHtml } from './description-html'

describe('description-html', () => {
  it('keeps supported description tags and link hrefs', () => {
    const html = sanitizeDescriptionHtml(
      '<blockquote><p>Hello <strong>world</strong> <u>underlined</u> <s>removed</s> <a href="https://bookorbit.app">BookOrbit</a></p></blockquote>',
    )

    expect(html).toBe(
      '<blockquote><p>Hello <strong>world</strong> <u>underlined</u> <s>removed</s> <a href="https://bookorbit.app">BookOrbit</a></p></blockquote>',
    )
  })

  it('removes unsupported tags and unsafe attributes', () => {
    const html = sanitizeDescriptionHtml('<p onclick="alert(1)">Hello</p><script>alert(1)</script><img src="x">')

    expect(html).toBe('<p>Hello</p>')
  })

  it('does not treat nested script-like input as visible markup', () => {
    const html = sanitizeDescriptionHtml('<scr<script>ipt>alert(1)</scr</script>ipt>')

    expect(html).not.toContain('<script')
  })

  it('normalizes empty editor output to null', () => {
    expect(normalizeDescriptionHtml('<p><br></p>')).toBeNull()
    expect(normalizeDescriptionHtml('<ul><li></li></ul>')).toBeNull()
  })

  it('returns sanitized HTML for visible content', () => {
    expect(normalizeDescriptionHtml('<p><em>Visible</em></p>')).toBe('<p><em>Visible</em></p>')
  })
})
