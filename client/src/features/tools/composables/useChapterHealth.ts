import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { ChapterHealthBook, ChapterHealthCategory, ChapterHealthSummary, ChapterLookupQueueState } from '@bookorbit/types'

import { errorMessage } from '@/lib/api-json'
import {
  cancelChapterLookups,
  clearFinishedChapterLookups,
  dismissChapterReview,
  enqueueChapterLookups,
  getChapterHealthBooks,
  getChapterHealthSummary,
  getChapterLookupState,
} from '../api/chapter-health'

const PAGE_SIZE = 50
const POLL_MS = 3_000

/** Categories a bulk lookup can help with; the review list and edited lists are past that point. */
export const LOOKUP_CATEGORIES: ReadonlySet<ChapterHealthCategory> = new Set(['no_chapters', 'one_per_file', 'numbered_tracks'])

/**
 * The Chapter health tool's state: counts per category, one page of the chosen category, the
 * selection, and the caller's bulk lookups. While lookups wait or run, the state is polled; when
 * the queue empties, the counts and the list are fetched again so applied books leave their category.
 */
export function useChapterHealth() {
  const category = ref<ChapterHealthCategory>('no_chapters')
  const libraryId = ref<number | null>(null)
  const summary = shallowRef<ChapterHealthSummary | null>(null)
  const items = shallowRef<ChapterHealthBook[]>([])
  const total = ref(0)
  const page = ref(1)
  const loadingList = ref(false)
  const error = ref<string | null>(null)
  const lookup = shallowRef<ChapterLookupQueueState | null>(null)
  const selected = ref<Set<number>>(new Set())
  let stopped = false
  let summaryToken = 0
  let lookupToken = 0
  let listToken = 0
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let wasActive = false

  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
  const lookupActive = computed(() => Boolean(lookup.value && (lookup.value.queued > 0 || lookup.value.processing)))
  const canLookUp = computed(() => LOOKUP_CATEGORIES.has(category.value))
  const lookupCandidates = computed(() => summary.value?.withAsin[category.value] ?? 0)

  async function loadSummary(): Promise<void> {
    const mine = ++summaryToken
    const next = await getChapterHealthSummary(libraryId.value).catch((reason) => {
      if (!stopped && mine === summaryToken) throw reason
      return null
    })
    if (next && !stopped && mine === summaryToken) summary.value = next
  }

  async function loadPage(): Promise<void> {
    const mine = ++listToken
    loadingList.value = true
    try {
      const result = await getChapterHealthBooks({ category: category.value, libraryId: libraryId.value, page: page.value, pageSize: PAGE_SIZE })
      if (mine !== listToken) return
      total.value = result.total
      const lastPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE))
      if (page.value > lastPage) {
        page.value = lastPage
        await loadPage()
        return
      }
      items.value = result.items
    } catch (reason) {
      if (!stopped && mine === listToken) throw reason
    } finally {
      if (mine === listToken) loadingList.value = false
    }
  }

  async function loadLookup(): Promise<void> {
    const mine = ++lookupToken
    const next = await getChapterLookupState().catch((reason) => {
      if (!stopped && mine === lookupToken) throw reason
      return null
    })
    if (!next || stopped || mine !== lookupToken) return
    lookup.value = next
    schedulePoll()
  }

  function schedulePoll(): void {
    if (stopped) return
    if (pollTimer) clearTimeout(pollTimer)
    pollTimer = null
    const active = lookupActive.value
    if (wasActive && !active) void Promise.all([loadSummary(), loadPage()]).catch(() => {})
    wasActive = active
    if (active) pollTimer = setTimeout(() => void loadLookup().catch(() => schedulePoll()), POLL_MS)
  }

  async function refresh(): Promise<void> {
    stopped = false
    error.value = null
    try {
      await Promise.all([loadSummary(), loadPage(), loadLookup()])
    } catch (reason) {
      error.value = errorMessage(reason, 'tools.chapterHealth.errors.load')
    }
  }

  async function setCategory(next: ChapterHealthCategory): Promise<void> {
    category.value = next
    page.value = 1
    selected.value = new Set()
    await loadPage().catch((reason) => (error.value = errorMessage(reason, 'tools.chapterHealth.errors.load')))
  }

  async function setLibrary(next: number | null): Promise<void> {
    libraryId.value = next
    page.value = 1
    selected.value = new Set()
    await refresh()
  }

  async function setPage(next: number): Promise<void> {
    page.value = Math.min(pageCount.value, Math.max(1, next))
    await loadPage().catch((reason) => (error.value = errorMessage(reason, 'tools.chapterHealth.errors.load')))
  }

  function toggle(bookId: number): void {
    const next = new Set(selected.value)
    if (next.has(bookId)) next.delete(bookId)
    else next.add(bookId)
    selected.value = next
  }

  function clearSelection(): void {
    selected.value = new Set()
  }

  /** Looks up the selection, or every book with an ASIN in the category when nothing is selected. */
  async function lookUp(): Promise<{ queued: number; skipped: number }> {
    const payload =
      selected.value.size > 0
        ? { bookIds: [...selected.value] }
        : { category: category.value, ...(libraryId.value === null ? {} : { libraryId: libraryId.value }) }
    const result = await enqueueChapterLookups(payload)
    selected.value = new Set()
    await loadLookup()
    return result
  }

  async function cancel(): Promise<void> {
    await cancelChapterLookups()
    await loadLookup()
  }

  async function clearFinished(): Promise<void> {
    await clearFinishedChapterLookups()
    await loadLookup()
  }

  async function dismiss(bookId: number): Promise<void> {
    await dismissChapterReview(bookId)
    await Promise.all([loadSummary(), loadPage(), loadLookup()])
  }

  function stop(): void {
    stopped = true
    listToken += 1
    summaryToken += 1
    lookupToken += 1
    if (pollTimer) clearTimeout(pollTimer)
    pollTimer = null
  }

  onBeforeUnmount(stop)

  return {
    category,
    libraryId,
    summary,
    items,
    total,
    page,
    pageCount,
    loadingList,
    error,
    lookup,
    lookupActive,
    canLookUp,
    lookupCandidates,
    selected,
    refresh,
    setCategory,
    setLibrary,
    setPage,
    toggle,
    clearSelection,
    lookUp,
    cancel,
    clearFinished,
    dismiss,
    stop,
  }
}
