import DOMPurify from 'dompurify'

// Minimal markdown renderer for the technical changelog (semantic-release output:
// headings, bullet lists, links, bold, inline code, fenced code, horizontal rules).
// Kept dependency-free on purpose; DOMPurify is the security backstop.

const ALLOWED_TAGS = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'br',
  'hr',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'b',
  'i',
  'del',
  'code',
  'pre',
  'blockquote',
  'a',
]

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function renderInline(text: string): string {
  let out = escapeHtml(text)
  out = out.replace(/`([^`]+)`/g, (_, code: string) => `<code>${code}</code>`)
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, url: string) => `<a href="${escapeHtml(url)}">${label}</a>`)
  return out
}

function toHtml(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let inList = false
  let inCode = false
  let code: string[] = []

  const closeList = () => {
    if (inList) {
      out.push('</ul>')
      inList = false
    }
  }

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
        inCode = false
        code = []
      } else {
        closeList()
        inCode = true
      }
      continue
    }
    if (inCode) {
      code.push(line)
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      closeList()
      const level = (heading[1] ?? '#').length
      out.push(`<h${level}>${renderInline(heading[2] ?? '')}</h${level}>`)
      continue
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      closeList()
      out.push('<hr>')
      continue
    }
    const item = line.match(/^\s*[-*]\s+(.*)$/)
    if (item) {
      if (!inList) {
        out.push('<ul>')
        inList = true
      }
      out.push(`<li>${renderInline(item[1] ?? '')}</li>`)
      continue
    }
    if (line.trim() === '') {
      closeList()
      continue
    }
    closeList()
    out.push(`<p>${renderInline(line)}</p>`)
  }

  if (inCode) out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
  closeList()
  return out.join('\n')
}

export function renderChangelogMarkdown(md: string | null | undefined): string {
  if (!md) return ''
  return DOMPurify.sanitize(toHtml(md), { ALLOWED_TAGS, ALLOWED_ATTR: ['href', 'target', 'rel'] })
}
