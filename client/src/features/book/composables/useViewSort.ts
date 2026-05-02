import { computed, watch, type Ref } from 'vue'
import type { SortSpec } from '@bookorbit/types'
import { SORT_FIELD_LABELS } from '../lib/filter-labels'

const DEFAULT_SORT: SortSpec[] = [{ field: 'title', dir: 'asc' }]

function storageKey(prefix: string, id: number) {
  return `bookorbit:sort:${prefix}:${id}`
}

export function useViewSort(sort: Ref<SortSpec[]>, keyPrefix: string, entityId: Ref<number | null>) {
  watch(
    entityId,
    (id) => {
      if (id === null) return
      try {
        const raw = localStorage.getItem(storageKey(keyPrefix, id))
        sort.value = raw ? JSON.parse(raw) : [...DEFAULT_SORT]
      } catch {
        sort.value = [...DEFAULT_SORT]
      }
    },
    { immediate: true },
  )

  function saveSort() {
    const id = entityId.value
    if (id === null) return
    localStorage.setItem(storageKey(keyPrefix, id), JSON.stringify(sort.value))
  }

  function resetSort() {
    sort.value = [...DEFAULT_SORT]
    const id = entityId.value
    if (id !== null) localStorage.removeItem(storageKey(keyPrefix, id))
  }

  const sortModel = computed({
    get: () => sort.value,
    set: (v: SortSpec[]) => {
      sort.value = v.length > 0 ? v : [...DEFAULT_SORT]
      saveSort()
    },
  })

  const isDefaultSort = computed(() => sort.value.length === 1 && sort.value[0]?.field === 'title' && sort.value[0]?.dir === 'asc')

  const sortSummary = computed(() => sort.value.map((s) => `${SORT_FIELD_LABELS[s.field]} ${s.dir === 'asc' ? '↑' : '↓'}`).join(', '))

  return { sortModel, isDefaultSort, sortSummary, resetSort, saveSort }
}
