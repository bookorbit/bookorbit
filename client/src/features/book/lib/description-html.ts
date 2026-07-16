import DOMPurify from 'dompurify'

export const DESCRIPTION_HTML_TAGS = ['b', 'i', 'em', 'strong', 's', 'u', 'p', 'br', 'ul', 'ol', 'li', 'a', 'blockquote'] as const
export const DESCRIPTION_HTML_ATTRS = ['href'] as const

export function sanitizeDescriptionHtml(content: string): string {
  return DOMPurify.sanitize(content, {
    ALLOWED_TAGS: [...DESCRIPTION_HTML_TAGS],
    ALLOWED_ATTR: [...DESCRIPTION_HTML_ATTRS],
  })
}

export function normalizeDescriptionHtml(content: string | null | undefined): string | null {
  const sanitized = sanitizeDescriptionHtml(content ?? '')
  return hasVisibleDescriptionText(sanitized) ? sanitized : null
}

function hasVisibleDescriptionText(content: string): boolean {
  const template = document.createElement('template')
  template.innerHTML = content
  return (template.content.textContent ?? '').trim().length > 0
}
