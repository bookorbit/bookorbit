import { computed, onScopeDispose, ref, shallowRef, toValue, triggerRef, watch, type MaybeRefOrGetter } from 'vue'
import type { ReadingHistoryItem, ReadingHistoryMonth } from '@bookorbit/types'
import { fetchReadingHistoryPage, type ReadingHistoryListParams } from '../api/reading-history.api'

export const READING_HISTORY_PAGE_SIZE = 100

/** One row of the list: a month's header, or the read at a position in the whole list. */
export type ReadingHistoryRow =
  { kind: 'month'; key: string; month: ReadingHistoryMonth } | { kind: 'read'; key: string; index: number; month: string }

/** What sits at the top of the screen, so switching between List and Covers can put it back there. */
export type ReadingHistoryAnchor = { kind: 'month'; month: string } | { kind: 'read'; index: number }

/**
 * The list behind History, loaded a page at a time as rows come into view.
 *
 * The first page carries every month's size, so the whole list is laid out (month headers plus a
 * placeholder per read) before most of it has loaded, and the scrollbar is right from the start.
 * Rows ask for their page with `ensureRange`; a page is fetched once. Changing the filters keeps
 * the old rows on screen until the new first page lands, and cancels requests still in flight, so
 * a slow old answer can never land in a new list.
 */
export function useReadingHistoryList(params: MaybeRefOrGetter<ReadingHistoryListParams>) {
  const months = ref<ReadingHistoryMonth[]>([])
  const total = ref(0)
  const loaded = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const pages = shallowRef(new Map<number, ReadingHistoryItem[]>())
  const pending = new Set<number>()
  let generation = 0
  let controller: AbortController | null = null
  let current: ReadingHistoryListParams | null = null
  /** The pages on screen belong to the previous filters: shown until the new first page lands, never reused. */
  let stale = false

  const rows = computed<ReadingHistoryRow[]>(() => {
    const out: ReadingHistoryRow[] = []
    let index = 0
    for (const month of months.value) {
      out.push({ kind: 'month', key: `m-${month.month}`, month })
      for (let i = 0; i < month.reads; i++, index++) out.push({ kind: 'read', key: `r-${index}`, index, month: month.month })
    }
    return out
  })

  function itemAt(index: number): ReadingHistoryItem | null {
    return pages.value.get(Math.floor(index / READING_HISTORY_PAGE_SIZE))?.[index % READING_HISTORY_PAGE_SIZE] ?? null
  }

  async function loadPage(page: number, gen: number) {
    if (!current || pending.has(page) || (!stale && pages.value.has(page))) return
    pending.add(page)
    try {
      const result = await fetchReadingHistoryPage(current, page * READING_HISTORY_PAGE_SIZE, READING_HISTORY_PAGE_SIZE, controller?.signal)
      if (gen !== generation) return
      if (stale) {
        pages.value = new Map()
        stale = false
      }
      pages.value.set(page, result.items)
      triggerRef(pages)
      if (result.months) months.value = result.months
      total.value = result.total
    } catch (err) {
      if (gen !== generation || (err instanceof DOMException && err.name === 'AbortError')) return
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      if (gen === generation) pending.delete(page)
    }
  }

  /** Loads every page the reads from `start` to `end` (list positions, inclusive) fall on. */
  function ensureRange(start: number, end: number) {
    if (loading.value || total.value === 0) return
    const last = Math.min(end, total.value - 1)
    for (let page = Math.floor(Math.max(0, start) / READING_HISTORY_PAGE_SIZE); page <= Math.floor(last / READING_HISTORY_PAGE_SIZE); page++) {
      void loadPage(page, generation)
    }
  }

  async function reset(next: ReadingHistoryListParams) {
    generation++
    controller?.abort()
    controller = new AbortController()
    current = { ...next, outcomes: [...next.outcomes] }
    pending.clear()
    // The old rows stay on screen until the new first page replaces them, so a filter change
    // dims the list instead of flashing it empty.
    stale = true
    error.value = null
    loading.value = true
    const gen = generation
    await loadPage(0, gen)
    if (gen !== generation) return
    if (stale) {
      // The first page failed: drop what belonged to the old filters rather than pass it off as the new.
      pages.value = new Map()
      months.value = []
      total.value = 0
      stale = false
    }
    loaded.value = true
    loading.value = false
  }

  function findItem(id: number): ReadingHistoryItem | null {
    for (const items of pages.value.values()) {
      const found = items.find((item) => item.id === id)
      if (found) return found
    }
    return null
  }

  /** Writes a change to one read into whatever page holds it, without refetching. */
  function patchItem(id: number, patch: Partial<ReadingHistoryItem>) {
    for (const items of pages.value.values()) {
      const index = items.findIndex((item) => item.id === id)
      if (index === -1) continue
      items[index] = { ...items[index]!, ...patch }
      triggerRef(pages)
      return
    }
  }

  function refresh() {
    if (current) void reset(current)
  }

  // Keyed by value: syncing the URL rebuilds the filters with equal values (a view switch does),
  // and that must not refetch.
  watch(
    () => JSON.stringify(toValue(params)),
    () => void reset(toValue(params)),
    { immediate: true },
  )
  onScopeDispose(() => controller?.abort())

  return { months, total, rows, loaded, loading, error, itemAt, findItem, ensureRange, patchItem, refresh }
}
