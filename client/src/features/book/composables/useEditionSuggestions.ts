import { onScopeDispose, ref, watch, type Ref } from 'vue'
import type { BookEditionSuggestion } from '@bookorbit/types'
import { fetchEditionSuggestions } from '@/features/book/api/book-link'

/**
 * Books that look like other editions of one book, for the Add edition picker. Loaded once per
 * book; a failure only leaves the list empty, since searching still works.
 */
export function useEditionSuggestions(bookId: Ref<number | null>) {
  const suggestions = ref<BookEditionSuggestion[]>([])
  const loading = ref(false)
  let controller: AbortController | null = null

  async function load(id: number | null): Promise<void> {
    controller?.abort()
    controller = null
    suggestions.value = []
    if (id === null) {
      loading.value = false
      return
    }
    const request = new AbortController()
    controller = request
    loading.value = true
    try {
      const page = await fetchEditionSuggestions(id, request.signal)
      if (controller === request) suggestions.value = page.items
    } catch {
      if (controller === request) suggestions.value = []
    } finally {
      if (controller === request) loading.value = false
    }
  }

  watch(bookId, (id) => void load(id), { immediate: true })
  onScopeDispose(() => controller?.abort())

  return { suggestions, loading }
}
