import { computed, onActivated, onDeactivated, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import type {
  BrokenCoverEntry,
  CoverSweep,
  MissingBookEntry,
  MissingResourceCategory,
  MissingResourceCleanupResult,
  MissingResourcesSummary,
  OrphanedCoverDirEntry,
} from '@bookorbit/types'

import {
  cleanBrokenCovers,
  cleanMissingBooks,
  cleanOrphanedCoverDirs,
  getBrokenCovers,
  getCoverSweep,
  getMissingBooks,
  getMissingResourcesSummary,
  getOrphanedCoverDirs,
  startCoverSweep,
} from '../api/missing-resources'

export type MissingResourceEntry = MissingBookEntry | BrokenCoverEntry | OrphanedCoverDirEntry

const POLL_INTERVAL_MS = 1000
const PAGE_SIZE = 50
/** Cleaning "all" runs in server-side passes; this caps how many passes one click will chain. */
const MAX_CLEAN_PASSES = 40

export function entryId(entry: MissingResourceEntry): number {
  return 'bookId' in entry ? entry.bookId : entry.id
}

export function useMissingResources() {
  const { t } = useI18n()

  const summary = ref<MissingResourcesSummary | null>(null)
  const category = ref<MissingResourceCategory>('missing_books')
  /** The category the loaded rows belong to. Rendering must follow this, not the pending selection. */
  const loadedCategory = ref<MissingResourceCategory>('missing_books')
  const items = ref<MissingResourceEntry[]>([])
  const total = ref(0)
  const page = ref(1)
  const loading = ref(false)
  const loaded = ref(false)
  const cleaning = ref(false)
  const error = ref<string | null>(null)
  const selectedIds = ref(new Set<number>())
  const selectAllMatching = ref(false)

  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let active = true
  let disposed = false
  let listRequestId = 0

  const sweep = computed<CoverSweep | null>(() => summary.value?.sweep ?? null)
  const sweeping = computed(() => sweep.value?.status === 'running')
  const sweepReady = computed(() => sweep.value?.status === 'completed')
  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
  const needsSweep = computed(() => category.value !== 'missing_books' && !sweepReady.value)
  const selectionCount = computed(() => (selectAllMatching.value ? total.value : selectedIds.value.size))
  const hasSelection = computed(() => selectionCount.value > 0)
  const allOnPageSelected = computed(() => items.value.length > 0 && items.value.every((item) => selectedIds.value.has(entryId(item))))

  const counts = computed(() => ({
    missing_books: summary.value?.missingBooks ?? 0,
    broken_covers: sweep.value?.brokenCovers ?? 0,
    orphaned_cover_dirs: sweep.value?.orphanedCoverDirs ?? 0,
  }))

  onActivated(() => {
    active = true
    if (sweeping.value) schedulePoll()
  })
  onDeactivated(() => {
    active = false
    stopPolling()
  })
  onUnmounted(() => {
    disposed = true
    stopPolling()
  })

  function stopPolling(): void {
    if (pollTimer !== null) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
  }

  function schedulePoll(): void {
    stopPolling()
    if (!active || disposed) return
    pollTimer = setTimeout(pollSweep, POLL_INTERVAL_MS)
  }

  async function pollSweep(): Promise<void> {
    if (disposed) return
    try {
      const next = await getCoverSweep()
      if (summary.value) summary.value = { ...summary.value, sweep: next }
      if (next?.status === 'running') {
        schedulePoll()
        return
      }
      if (next?.status === 'failed') {
        error.value = t('tools.missingResources.errors.sweep')
        return
      }
      await loadPage(1)
    } catch {
      error.value = t('tools.missingResources.errors.sweep')
    }
  }

  async function refreshSummary(): Promise<void> {
    try {
      summary.value = await getMissingResourcesSummary()
      if (sweeping.value) schedulePoll()
    } catch {
      error.value = t('tools.missingResources.errors.summary')
    }
  }

  async function initialize(): Promise<void> {
    await refreshSummary()
    await loadPage(1)
  }

  async function runSweep(): Promise<void> {
    error.value = null
    try {
      const started = await startCoverSweep()
      summary.value = summary.value ? { ...summary.value, sweep: started } : { missingBooks: 0, sweep: started }
      schedulePoll()
    } catch {
      error.value = t('tools.missingResources.errors.sweepStart')
    }
  }

  async function loadPage(nextPage: number): Promise<void> {
    if (needsSweep.value) {
      items.value = []
      total.value = 0
      loadedCategory.value = category.value
      loaded.value = true
      return
    }
    const requestId = (listRequestId += 1)
    loading.value = true
    error.value = null
    try {
      const requested = category.value
      const params = { page: nextPage, pageSize: PAGE_SIZE }
      const result =
        requested === 'missing_books'
          ? await getMissingBooks(params)
          : requested === 'broken_covers'
            ? await getBrokenCovers(params)
            : await getOrphanedCoverDirs(params)
      if (requestId !== listRequestId || disposed) return
      items.value = result.items
      loadedCategory.value = requested
      total.value = result.total
      page.value = result.page
    } catch {
      if (requestId !== listRequestId || disposed) return
      items.value = []
      loadedCategory.value = category.value
      total.value = 0
      error.value = t('tools.missingResources.errors.list')
    } finally {
      if (requestId === listRequestId) {
        loading.value = false
        loaded.value = true
      }
    }
  }

  async function setCategory(next: MissingResourceCategory): Promise<void> {
    if (category.value === next) return
    category.value = next
    // Drop the previous category's rows now; they do not match the shape the new category renders.
    items.value = []
    total.value = 0
    clearSelection()
    await loadPage(1)
  }

  async function setPage(next: number): Promise<void> {
    if (next < 1 || next > totalPages.value) return
    await loadPage(next)
  }

  function clearSelection(): void {
    selectedIds.value = new Set()
    selectAllMatching.value = false
  }

  function toggleSelection(id: number): void {
    const next = new Set(selectedIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedIds.value = next
    selectAllMatching.value = false
  }

  function togglePageSelection(): void {
    const next = new Set(selectedIds.value)
    const shouldSelect = !allOnPageSelected.value
    for (const item of items.value) {
      if (shouldSelect) next.add(entryId(item))
      else next.delete(entryId(item))
    }
    selectedIds.value = next
    selectAllMatching.value = false
  }

  function selectAll(): void {
    selectAllMatching.value = true
  }

  function cleanerFor(target: MissingResourceCategory) {
    if (target === 'missing_books') return cleanMissingBooks
    if (target === 'broken_covers') return cleanBrokenCovers
    return cleanOrphanedCoverDirs
  }

  async function cleanSelected(): Promise<boolean> {
    if (!hasSelection.value || cleaning.value) return false
    const target = category.value
    const cleaner = cleanerFor(target)
    cleaning.value = true
    error.value = null
    try {
      let cleaned = 0
      if (selectAllMatching.value) {
        let passes = 0
        for (;;) {
          const result: MissingResourceCleanupResult = await cleaner({ all: true })
          cleaned += result.cleaned
          passes += 1
          if (result.remaining === 0 || result.cleaned === 0 || passes >= MAX_CLEAN_PASSES) break
        }
      } else {
        const result = await cleaner({ bookIds: [...selectedIds.value] })
        cleaned = result.cleaned
      }
      clearSelection()
      await refreshSummary()
      await loadPage(1)
      toast.success(t(`tools.missingResources.cleaned.${target}`, { count: cleaned }))
      return true
    } catch {
      error.value = t('tools.missingResources.errors.clean')
      toast.error(t('tools.missingResources.errors.clean'))
      return false
    } finally {
      cleaning.value = false
    }
  }

  return {
    summary,
    sweep,
    sweeping,
    sweepReady,
    needsSweep,
    category,
    loadedCategory,
    counts,
    items,
    total,
    page,
    totalPages,
    loading,
    loaded,
    cleaning,
    error,
    selectedIds,
    selectAllMatching,
    selectionCount,
    hasSelection,
    allOnPageSelected,
    initialize,
    refreshSummary,
    runSweep,
    setCategory,
    setPage,
    toggleSelection,
    togglePageSelection,
    selectAll,
    clearSelection,
    cleanSelected,
  }
}
