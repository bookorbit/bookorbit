import { computed, onActivated, onDeactivated, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import type {
  BookDuplicateDismissal,
  BookDuplicateGroup,
  BookDuplicateGroupSort,
  BookDuplicateMatchReason,
  BookDuplicateScan,
  BookDuplicateSortOrder,
} from '@bookorbit/types'

import {
  createBookDuplicateScan,
  deleteDuplicateBooks,
  dismissBookDuplicateGroup,
  getActiveBookDuplicateScan,
  getBookDuplicateDismissals,
  getBookDuplicateGroups,
  getBookDuplicateScan,
  restoreBookDuplicateDismissal,
} from '../api/book-duplicates'
import { recommendKeeper, reclaimableBytes, type DuplicateKeepRule } from '../book-duplicates/utils/duplicate-keeper'

const POLL_INTERVAL_MS = 1000

export function useBookDuplicates() {
  const { t } = useI18n()
  const scan = ref<BookDuplicateScan | null>(null)
  const groups = ref<BookDuplicateGroup[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const reason = ref<BookDuplicateMatchReason | undefined>()
  const sortBy = ref<BookDuplicateGroupSort>('reclaimable')
  const order = ref<BookDuplicateSortOrder>('desc')
  const keepRule = ref<DuplicateKeepRule>('metadata')
  const keeperOverrides = ref(new Map<number, number>())
  const selectedGroupIds = ref(new Set<number>())
  const expandedGroupIds = ref(new Set<number>())
  const dismissals = ref<BookDuplicateDismissal[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const deleting = ref(false)
  const error = ref<string | null>(null)
  const hiddenGroupIds = ref(new Set<number>())
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let active = true
  let disposed = false
  let groupsRequestId = 0

  const visibleGroups = computed(() => groups.value.filter((group) => !hiddenGroupIds.value.has(group.id)))
  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
  const scanning = computed(() => scan.value?.status === 'queued' || scan.value?.status === 'running')
  const scanFinished = computed(() => scan.value?.status === 'completed')

  /** The keeper a group is currently resolved to: the user's pick, else the active rule's. */
  function keeperIdFor(group: BookDuplicateGroup): number {
    return keeperOverrides.value.get(group.id) ?? recommendKeeper(group, keepRule.value).keeperId
  }

  const selectedGroups = computed(() => visibleGroups.value.filter((group) => selectedGroupIds.value.has(group.id)))
  const selectionCopyCount = computed(() => selectedGroups.value.reduce((count, group) => count + group.books.length - 1, 0))
  const selectionBytes = computed(() => selectedGroups.value.reduce((bytes, group) => bytes + reclaimableBytes(group, keeperIdFor(group)), 0))
  const selectionBookIds = computed(() =>
    selectedGroups.value.flatMap((group) => group.books.filter((book) => book.id !== keeperIdFor(group)).map((book) => book.id)),
  )
  const allVisibleSelected = computed(
    () => visibleGroups.value.length > 0 && visibleGroups.value.every((group) => selectedGroupIds.value.has(group.id)),
  )

  onActivated(() => {
    active = true
    if (scanning.value) schedulePoll()
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

  function resetResults(): void {
    groups.value = []
    total.value = 0
    page.value = 1
    reason.value = undefined
    hiddenGroupIds.value = new Set()
    keeperOverrides.value = new Map()
    selectedGroupIds.value = new Set()
    expandedGroupIds.value = new Set()
    loaded.value = false
  }

  async function startScan(libraryId: number | undefined, similarityPercent: number): Promise<void> {
    stopPolling()
    groupsRequestId += 1
    loading.value = true
    error.value = null
    resetResults()
    try {
      scan.value = await createBookDuplicateScan({ libraryId, similarityPercent })
      schedulePoll()
    } catch {
      error.value = t('tools.bookDuplicates.errors.start')
    } finally {
      loading.value = false
    }
  }

  function schedulePoll(): void {
    stopPolling()
    if (!active || disposed) return
    pollTimer = setTimeout(pollScan, POLL_INTERVAL_MS)
  }

  async function pollScan(): Promise<void> {
    if (!scan.value) return
    const scanId = scan.value.id
    try {
      const nextScan = await getBookDuplicateScan(scanId)
      if (!scan.value || scan.value.id !== scanId || disposed) return
      scan.value = nextScan
      error.value = null
      if (scan.value.status === 'completed') {
        await fetchGroups()
        return
      }
      if (scan.value.status === 'failed') {
        error.value = t('tools.bookDuplicates.errors.scan')
        return
      }
      schedulePoll()
    } catch {
      error.value = t('tools.bookDuplicates.errors.status')
      schedulePoll()
    }
  }

  async function resumeActiveScan(): Promise<void> {
    loading.value = true
    try {
      const activeScan = await getActiveBookDuplicateScan()
      if (!activeScan || disposed) return
      scan.value = activeScan
      error.value = null
      schedulePoll()
    } catch {
      error.value = t('tools.bookDuplicates.errors.status')
    } finally {
      loading.value = false
    }
  }

  async function fetchGroups(): Promise<void> {
    if (!scan.value || scan.value.status !== 'completed') return
    const requestId = ++groupsRequestId
    loading.value = true
    error.value = null
    try {
      let response = await getBookDuplicateGroups(scan.value.id, {
        page: page.value,
        pageSize: pageSize.value,
        reason: reason.value,
        sortBy: sortBy.value,
        order: order.value,
      })
      if (requestId !== groupsRequestId || disposed) return
      const lastPage = Math.max(1, Math.ceil(response.total / pageSize.value))
      if (response.page > lastPage) {
        page.value = lastPage
        response = await getBookDuplicateGroups(scan.value.id, {
          page: lastPage,
          pageSize: pageSize.value,
          reason: reason.value,
          sortBy: sortBy.value,
          order: order.value,
        })
        if (requestId !== groupsRequestId || disposed) return
      }
      groups.value = response.groups
      total.value = response.total
      page.value = response.page
      loaded.value = true
    } catch {
      error.value = t('tools.bookDuplicates.errors.results')
    } finally {
      if (requestId === groupsRequestId) loading.value = false
    }
  }

  async function setReason(value: BookDuplicateMatchReason | undefined): Promise<void> {
    reason.value = value
    page.value = 1
    await fetchGroups()
  }

  async function setSort(value: BookDuplicateGroupSort, direction: BookDuplicateSortOrder = 'desc'): Promise<void> {
    sortBy.value = value
    order.value = direction
    page.value = 1
    await fetchGroups()
  }

  async function setPage(value: number): Promise<void> {
    page.value = Math.max(1, Math.min(value, totalPages.value))
    await fetchGroups()
  }

  function setKeepRule(rule: DuplicateKeepRule): void {
    keepRule.value = rule
    keeperOverrides.value = new Map()
  }

  function setKeeper(groupId: number, bookId: number): void {
    const next = new Map(keeperOverrides.value)
    next.set(groupId, bookId)
    keeperOverrides.value = next
  }

  function toggleExpanded(groupId: number): void {
    const next = new Set(expandedGroupIds.value)
    if (next.has(groupId)) next.delete(groupId)
    else next.add(groupId)
    expandedGroupIds.value = next
  }

  function toggleSelected(groupId: number): void {
    const next = new Set(selectedGroupIds.value)
    if (next.has(groupId)) next.delete(groupId)
    else next.add(groupId)
    selectedGroupIds.value = next
  }

  function toggleSelectAll(): void {
    selectedGroupIds.value = allVisibleSelected.value ? new Set() : new Set(visibleGroups.value.map((group) => group.id))
  }

  function clearSelection(): void {
    selectedGroupIds.value = new Set()
  }

  function hideGroup(groupId: number): void {
    hiddenGroupIds.value = new Set(hiddenGroupIds.value).add(groupId)
    const selection = new Set(selectedGroupIds.value)
    selection.delete(groupId)
    selectedGroupIds.value = selection
  }

  /**
   * A judgement, not a filter: the pair is stored server-side so the next scan does not rebuild the
   * same group. The row is hidden immediately because the current scan still holds it.
   */
  async function dismissGroup(groupId: number): Promise<void> {
    if (!scan.value) return
    hideGroup(groupId)
    try {
      await dismissBookDuplicateGroup({ scanId: scan.value.id, groupId })
      await fetchDismissals()
    } catch {
      toast.error(t('tools.bookDuplicates.errors.dismiss'))
    }
  }

  async function fetchDismissals(): Promise<void> {
    try {
      dismissals.value = await getBookDuplicateDismissals()
    } catch {
      /* the dismissed list is supplementary; its failure must not break the review */
    }
  }

  async function restoreDismissal(bookIdA: number, bookIdB: number): Promise<void> {
    try {
      await restoreBookDuplicateDismissal(bookIdA, bookIdB)
      dismissals.value = dismissals.value.filter((entry) => !(entry.bookIdA === bookIdA && entry.bookIdB === bookIdB))
      toast.success(t('tools.bookDuplicates.dismissed.restored'))
    } catch {
      toast.error(t('tools.bookDuplicates.errors.restore'))
    }
  }

  async function discardBooks(bookIds: number[]): Promise<boolean> {
    if (bookIds.length === 0) return false
    deleting.value = true
    try {
      await deleteDuplicateBooks(bookIds)
      clearSelection()
      await fetchGroups()
      toast.success(t('tools.bookDuplicates.deleteDialog.success', { count: bookIds.length }, bookIds.length))
      return true
    } catch {
      toast.error(t('tools.bookDuplicates.errors.delete'))
      return false
    } finally {
      deleting.value = false
    }
  }

  return {
    scan,
    visibleGroups,
    total,
    page,
    pageSize,
    reason,
    sortBy,
    order,
    keepRule,
    keeperOverrides,
    selectedGroupIds,
    expandedGroupIds,
    selectedGroups,
    selectionCopyCount,
    selectionBytes,
    selectionBookIds,
    allVisibleSelected,
    dismissals,
    totalPages,
    scanning,
    scanFinished,
    loading,
    loaded,
    deleting,
    error,
    keeperIdFor,
    startScan,
    resumeActiveScan,
    fetchGroups,
    fetchDismissals,
    setReason,
    setSort,
    setPage,
    setKeepRule,
    setKeeper,
    toggleExpanded,
    toggleSelected,
    toggleSelectAll,
    clearSelection,
    hideGroup,
    dismissGroup,
    restoreDismissal,
    discardBooks,
  }
}
