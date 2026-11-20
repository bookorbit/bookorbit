import { ref, type Ref } from 'vue'
import type { TaxonomyDetail, TaxonomyKind, TaxonomyName } from '@bookorbit/types'
import { fetchSimilarTaxonomy, fetchTaxonomyDetail, TaxonomyRequestError } from '../api/taxonomy'

/** One genre or tag: its name and library counts, and the names that read like it. */
export function useTaxonomyDetail(kind: TaxonomyKind, id: Ref<number>) {
  const detail = ref<TaxonomyDetail | null>(null)
  const similar = ref<TaxonomyName[]>([])
  const loaded = ref(false)
  const notFound = ref(false)
  const error = ref<string | null>(null)

  let token = 0

  async function load(): Promise<void> {
    const current = ++token
    notFound.value = false
    error.value = null
    if (!Number.isInteger(id.value) || id.value <= 0) {
      detail.value = null
      similar.value = []
      notFound.value = true
      loaded.value = true
      return
    }
    try {
      const [entry, names] = await Promise.all([
        fetchTaxonomyDetail(kind, id.value),
        fetchSimilarTaxonomy(kind, id.value).catch(() => ({ items: [] as TaxonomyName[] })),
      ])
      if (current !== token) return
      detail.value = entry
      similar.value = names.items
    } catch (err) {
      if (current !== token) return
      detail.value = null
      similar.value = []
      if (err instanceof TaxonomyRequestError && err.status === 404) notFound.value = true
      else error.value = err instanceof Error ? err.message : 'Failed to load'
    } finally {
      if (current === token) loaded.value = true
    }
  }

  return { detail, similar, loaded, notFound, error, load }
}
