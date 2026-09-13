import { computed, ref } from 'vue'

import type { AuthorSummary } from '@bookorbit/types'
import { fetchAuthors } from '../api/author'
import type { AuthorListSort, SortDirection } from '../types/author'

const PAGE_SIZE = 50

export function useAuthorsList() {
  const items = ref<AuthorSummary[]>([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const q = ref('')
  const sort = ref<AuthorListSort>('name')
  const order = ref<SortDirection>('asc')
  const libraryId = ref<number | null>(null)
  const hasPhoto = ref<boolean | null>(null)
  const hasSortName = ref<boolean | null>(null)
  const addedWithinDays = ref<number | null>(null)
  const minBookCount = ref<number | null>(null)

  const page = ref(0)
  const hasMore = computed(() => items.value.length < total.value)

  function filterParams() {
    return {
      q: q.value.trim() || undefined,
      libraryId: libraryId.value,
      hasPhoto: hasPhoto.value,
      hasSortName: hasSortName.value,
      addedWithinDays: addedWithinDays.value,
      minBookCount: minBookCount.value,
    }
  }

  async function load(reset = false): Promise<void> {
    if (loading.value) return
    if (!reset && !hasMore.value) return

    loading.value = true
    error.value = null

    if (reset) {
      page.value = 0
      items.value = []
    }

    try {
      const data = await fetchAuthors({
        ...filterParams(),
        page: page.value,
        size: PAGE_SIZE,
        sort: sort.value,
        order: order.value,
      })

      items.value = reset ? data.items : [...items.value, ...data.items]
      total.value = data.total
      page.value += 1
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load authors'
    } finally {
      loading.value = false
    }
  }

  /**
   * Loads forward until `index` is materialised, so a jump-rail target that sits
   * beyond the pages fetched so far can still be scrolled to. Bounded by `total`
   * and by any page that comes back short, so it cannot spin on a stale count.
   */
  async function loadThrough(index: number): Promise<boolean> {
    let guard = 0
    while (items.value.length <= index && hasMore.value && guard < 200) {
      const before = items.value.length
      await load()
      if (items.value.length === before) return false
      guard += 1
    }
    return items.value.length > index
  }

  return {
    items,
    total,
    loading,
    error,
    hasMore,
    q,
    sort,
    order,
    libraryId,
    hasPhoto,
    hasSortName,
    addedWithinDays,
    minBookCount,
    filterParams,
    load,
    loadThrough,
  }
}
