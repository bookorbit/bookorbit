import { describe, expect, it } from 'vitest'

import { renderChangelogMarkdown } from './markdown'

describe('renderChangelogMarkdown', () => {
  it('renders headings, lists, bold, code and links', () => {
    const md = ['### Features', '- add **two-way** sync', '- speed up `jumpRail`', '', '[issue](https://example.com/1)'].join('\n')
    const html = renderChangelogMarkdown(md)
    expect(html).toContain('<h3>Features</h3>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<strong>two-way</strong>')
    expect(html).toContain('<code>jumpRail</code>')
    expect(html).toMatch(/<a [^>]*href="https:\/\/example\.com\/1"[^>]*>issue<\/a>/)
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('renders fenced code blocks and horizontal rules', () => {
    const html = renderChangelogMarkdown(['---', '```bash', 'docker pull x', '```'].join('\n'))
    expect(html).toContain('<hr>')
    expect(html).toContain('<pre><code>docker pull x</code></pre>')
  })

  it('strips dangerous markup', () => {
    const html = renderChangelogMarkdown('<script>alert(1)</script>\n[x](javascript:alert(1))')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('javascript:')
  })

  it('escapes quotes in markdown link destinations before creating attributes', () => {
    const html = renderChangelogMarkdown('[safe](https://example.com/"onmouseover="alert(1))')
    const template = document.createElement('template')
    template.innerHTML = html
    const anchor = template.content.querySelector('a')

    expect(anchor).not.toBeNull()
    expect(anchor!.getAttribute('onmouseover')).toBeNull()
    expect(anchor!.getAttributeNames().sort()).toEqual(['href', 'rel', 'target'])
  })

  it('returns empty string for empty input', () => {
    expect(renderChangelogMarkdown(null)).toBe('')
    expect(renderChangelogMarkdown('')).toBe('')
  })
})
