import { computed } from 'vue'
import DOMPurify from 'dompurify'

const SAFE_TAGS = ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li', 'a']

export function useSafeHtml(rawHtml: () => string | null | undefined) {
  return computed(() => {
    const content = rawHtml()
    if (!content) return ''
    return DOMPurify.sanitize(content, { ALLOWED_TAGS: SAFE_TAGS })
  })
}
