import { computed, ref } from 'vue'
import type { TaxonomyIndexSort, TaxonomyKind, TaxonomyName, TaxonomySummary } from '@bookorbit/types'
import { fetchTaxonomyPage, type SortDirection } from '../api/taxonomy'

const PAGE_SIZE = 50
/** How many of the biggest names the cloud shows above its letters. */
export const TAXONOMY_TOP_COUNT = 18

/**
 * One kind's index, a page at a time. `totals` counts both kinds in the chosen libraries so the
 * Genres | Tags switch can say what the other side holds without loading it.
 */
export function useTaxonomyList(kind: TaxonomyKind) {
  const items = ref<TaxonomySummary[]>([])
  const total = ref(0)
  const totals = ref<Record<TaxonomyKind, number>>({ genre: 0, tag: 0 })
  const top = ref<TaxonomyName[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const q = ref('')
  const sort = ref<TaxonomyIndexSort>('bookCount')
  const order = ref<SortDirection>('desc')
  const libraryId = ref<number | null>(null)

  const page = ref(0)
  const hasMore = computed(() => items.value.length < total.value)

  let requestToken = 0
  let topToken = 0

  async function load(reset = false): Promise<void> {
    if (!reset && loading.value) return
    if (!reset && !hasMore.value) return

    const token = ++requestToken
    loading.value = true
    error.value = null

    const requestPage = reset ? 0 : page.value
    if (reset) {
      page.value = 0
      items.value = []
    }

    try {
      const data = await fetchTaxonomyPage(kind, {
        q: q.value.trim() || undefined,
        page: requestPage,
        size: PAGE_SIZE,
        sort: sort.value,
        order: order.value,
        libraryId: libraryId.value,
      })
      if (token !== requestToken) return

      items.value = reset ? data.items : [...items.value, ...data.items]
      total.value = data.total
      totals.value = data.totals
      page.value = requestPage + 1
    } catch (err) {
      if (token !== requestToken) return
      error.value = err instanceof Error ? err.message : 'Failed to load'
    } finally {
      if (token === requestToken) loading.value = false
    }
  }

  /** The cloud's "Most books" strip: the biggest names in the chosen libraries, whatever the sort. */
  async function loadTop(): Promise<void> {
    const token = ++topToken
    try {
      const data = await fetchTaxonomyPage(kind, {
        page: 0,
        size: TAXONOMY_TOP_COUNT,
        sort: 'bookCount',
        order: 'desc',
        libraryId: libraryId.value,
      })
      if (token !== topToken) return
      top.value = data.items.map(({ id, name, bookCount }) => ({ id, name, bookCount }))
    } catch {
      if (token === topToken) top.value = []
    }
  }

  return { items, total, totals, top, loading, error, hasMore, q, sort, order, libraryId, load, loadTop }
}
