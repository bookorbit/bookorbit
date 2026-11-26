import { onActivated, ref, watch, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

export function parseLibraryIdQuery(value: unknown): number | null {
  const raw = typeof value === 'string' ? Number(value) : NaN
  return Number.isInteger(raw) && raw > 0 ? raw : null
}

/**
 * Keeps a page's library choice in its `?libraryId=` query, so a link can open the page on one
 * library. Pages kept alive by path come back with whatever query the new visit carries, so the
 * choice is read again on every activation instead of only at setup.
 */
export function useLibraryQueryParam(libraryId: Ref<number | null> = ref<number | null>(null)): Ref<number | null> {
  const route = useRoute()
  const router = useRouter()

  libraryId.value = parseLibraryIdQuery(route.query.libraryId)

  watch(libraryId, (value) => {
    if (parseLibraryIdQuery(route.query.libraryId) === value) return
    void router.replace({ query: { ...route.query, libraryId: value ? String(value) : undefined } })
  })

  onActivated(() => {
    libraryId.value = parseLibraryIdQuery(route.query.libraryId)
  })

  return libraryId
}
