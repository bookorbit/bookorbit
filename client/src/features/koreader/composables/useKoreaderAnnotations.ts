import { ref, watch, type Ref } from 'vue'
import { api } from '@/lib/api'
import type { KoreaderAnnotationItem } from '@bookorbit/types'

export function useKoreaderAnnotations(bookId: Ref<number>) {
  const items = ref<KoreaderAnnotationItem[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchAnnotations(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const res = await api(`/api/v1/koreader/books/${bookId.value}/annotations`)
      if (res.status === 403) {
        items.value = []
        return
      }
      if (!res.ok) throw new Error('Failed to fetch KOReader annotations')
      items.value = await res.json()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch KOReader annotations'
    } finally {
      loading.value = false
    }
  }

  watch(bookId, fetchAnnotations, { immediate: true })

  return { items, loading, error, fetchAnnotations }
}
