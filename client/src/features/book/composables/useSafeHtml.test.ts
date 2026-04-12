import { ref } from 'vue'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSafeHtml } from './useSafeHtml'

vi.mock('dompurify', () => ({
  default: {
    sanitize: vi.fn((input: string, config: { ALLOWED_TAGS: string[] }) => {
      if (!config?.ALLOWED_TAGS) return ''
      // Simulate DOMPurify by stripping disallowed tags and dangerous attributes
      return input
        .replace(/<script\b[^>]*>.*?<\/script>/gi, '')
        .replace(/\son\w+="[^"]*"/gi, '')
        .replace(/javascript:[^"']*/gi, '')
    }),
  },
}))

import DOMPurify from 'dompurify'
const sanitizeMock = vi.mocked(DOMPurify.sanitize)

describe('useSafeHtml', () => {
  beforeEach(() => {
    sanitizeMock.mockImplementation((input: string | Node) => String(input))
  })

  it('returns empty string when content is null', () => {
    const html = useSafeHtml(() => null)
    expect(html.value).toBe('')
  })

  it('returns empty string when content is undefined', () => {
    const html = useSafeHtml(() => undefined)
    expect(html.value).toBe('')
  })

  it('returns empty string when content is an empty string', () => {
    const html = useSafeHtml(() => '')
    expect(html.value).toBe('')
  })

  it('passes content through DOMPurify.sanitize with allowed tags', () => {
    const html = useSafeHtml(() => '<b>Hello</b>')
    const _ = html.value
    expect(sanitizeMock).toHaveBeenCalledWith('<b>Hello</b>', {
      ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li', 'a'],
    })
  })

  it('is reactive and updates when the source function returns a new value', () => {
    const raw = ref('<em>initial</em>')
    const html = useSafeHtml(() => raw.value)

    expect(html.value).toBe('<em>initial</em>')

    raw.value = '<strong>updated</strong>'
    expect(html.value).toBe('<strong>updated</strong>')
  })

  it('returns sanitized output (strips script tags)', () => {
    sanitizeMock.mockRestore()
    // Use the real mock behavior from the module-level mock
    sanitizeMock.mockImplementation((input: string | Node) => {
      const s = String(input)
      return s.replace(/<script\b[^>]*>.*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '')
    })

    const html = useSafeHtml(() => '<b>Safe</b><script>alert(1)</script>')
    expect(html.value).toBe('<b>Safe</b>')
    expect(html.value).not.toContain('<script>')
  })
})
