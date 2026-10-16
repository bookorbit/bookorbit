import { computed, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'
import type { SortSpec } from '@bookorbit/types'
import { sortFieldLabel } from '../lib/filter-labels'
import { DEFAULT_SORT, copySort, sortsEqual } from '../lib/sort-defaults'

function storageKey(prefix: string, id: number) {
  return `bookorbit:sort:${prefix}:${id}`
}

/**
 * A view's sort, remembered per entity in localStorage. The default may be reactive: a smart
 * scope's own default sort arrives with the scope, so `loadSort()` re-reads once it is known.
 */
export function useViewSort(
  sort: Ref<SortSpec[]>,
  keyPrefix: string,
  entityId: Ref<number | null>,
  defaultSort: MaybeRefOrGetter<SortSpec[]> = DEFAULT_SORT,
) {
  function loadSort() {
    const id = entityId.value
    if (id === null) return
    try {
      const raw = localStorage.getItem(storageKey(keyPrefix, id))
      sort.value = raw ? JSON.parse(raw) : copySort(toValue(defaultSort))
    } catch {
      sort.value = copySort(toValue(defaultSort))
    }
  }

  watch(entityId, loadSort, { immediate: true })

  function saveSort() {
    const id = entityId.value
    if (id === null) return
    localStorage.setItem(storageKey(keyPrefix, id), JSON.stringify(sort.value))
  }

  function resetSort() {
    sort.value = copySort(toValue(defaultSort))
    const id = entityId.value
    if (id !== null) localStorage.removeItem(storageKey(keyPrefix, id))
  }

  const sortModel = computed({
    get: () => sort.value,
    set: (v: SortSpec[]) => {
      sort.value = v.length > 0 ? v : copySort(toValue(defaultSort))
      saveSort()
    },
  })

  const isDefaultSort = computed(() => sortsEqual(sort.value, toValue(defaultSort)))

  const sortSummary = computed(() => sort.value.map((s) => `${sortFieldLabel(s.field)} ${s.dir === 'asc' ? '↑' : '↓'}`).join(', '))

  return { sortModel, isDefaultSort, sortSummary, resetSort, saveSort, loadSort }
}
