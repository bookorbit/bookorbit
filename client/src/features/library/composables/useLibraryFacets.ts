import { onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import type { GroupRule, LibraryBookFacets } from '@bookorbit/types'
import { api } from '@/lib/api'

const DEBOUNCE_MS = 150

/**
 * Format counts and totals for a library's browse header, from the same query as the listing.
 * The last counts stay on screen while a new filter is being counted, so typing or picking a
 * chip never flashes the bar empty; a request superseded by a newer one is aborted.
 */
export function useLibraryFacets(libraryId: Ref<number | null>, filter: Ref<GroupRule | undefined>, q: Ref<string>) {
  const facets = shallowRef<LibraryBookFacets | null>(null)
  const loading = ref(false)
  let controller: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let facetsLibraryId: number | null = null

  async function load() {
    const id = libraryId.value
    controller?.abort()
    if (id === null) {
      facets.value = null
      return
    }
    const request = new AbortController()
    controller = request
    loading.value = true
    const trimmed = q.value.trim()
    try {
      const res = await api(`/api/v1/libraries/${id}/books/facets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(filter.value ? { filter: filter.value } : {}), ...(trimmed ? { q: trimmed } : {}) }),
        signal: request.signal,
      })
      if (request.signal.aborted) return
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      facets.value = (await res.json()) as LibraryBookFacets
      facetsLibraryId = id
    } catch {
      if (request.signal.aborted) return
      if (facetsLibraryId !== id) facets.value = null
    } finally {
      if (controller === request) {
        loading.value = false
        controller = null
      }
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void load()
    }, DEBOUNCE_MS)
  }

  watch(
    libraryId,
    (id) => {
      if (id !== facetsLibraryId) facets.value = null
      void load()
    },
    { immediate: true },
  )
  watch([filter, q], schedule, { deep: true })

  onScopeDispose(() => {
    if (timer) clearTimeout(timer)
    controller?.abort()
  })

  return { facets, loading, refresh: load }
}
