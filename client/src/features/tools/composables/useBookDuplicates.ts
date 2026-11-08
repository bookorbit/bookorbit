import { computed, onActivated, onDeactivated, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import {
  BOOK_DUPLICATE_RESOLUTION_MAX_GROUPS,
  Permission,
  allowedDuplicateActions,
  defaultDuplicateAction,
  duplicateLinkAvailable,
  duplicateMergeAvailability,
  type BookDuplicateAction,
  type BookDuplicateBookAction,
  type BookDuplicateDismissal,
  type BookDuplicateGroup,
  type BookDuplicateGroupSort,
  type BookDuplicateKind,
  type BookDuplicateMatchReason,
  type BookDuplicateMergeAvailability,
  type BookDuplicatePermissions,
  type BookDuplicateResolutionJob,
  type BookDuplicateResolutionRequest,
  type BookDuplicateScan,
  type BookDuplicateSortOrder,
} from '@bookorbit/types'

import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useLibraryPermissions } from '@/features/library/composables/useLibraryPermissions'
import {
  createBookDuplicateScan,
  dismissBookDuplicateGroup,
  getActiveBookDuplicateScan,
  getBookDuplicateDismissals,
  getBookDuplicateGroups,
  getBookDuplicateScan,
  restoreBookDuplicateDismissal,
} from '../api/book-duplicates'
import { recommendKeeper, reclaimableBytes, type DuplicateKeepRule } from '../book-duplicates/utils/duplicate-keeper'
import { useDuplicateResolution } from './useDuplicateResolution'

const POLL_INTERVAL_MS = 1000

export interface ResolveOptions {
  /** Every group of the scan matching the current tab and filter, not only those on screen (H8). */
  allGroups?: boolean
  removeIdenticalCopies?: boolean
}

export function useBookDuplicates() {
  const { t } = useI18n()
  const { hasPermission } = usePermissions()
  const { hasLibraryPermission } = useLibraryPermissions()
  const scan = ref<BookDuplicateScan | null>(null)
  const kind = ref<BookDuplicateKind>('duplicate')
  const groups = ref<BookDuplicateGroup[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const reason = ref<BookDuplicateMatchReason | undefined>()
  const sortBy = ref<BookDuplicateGroupSort>('reclaimable')
  const order = ref<BookDuplicateSortOrder>('desc')
  const keepRule = ref<DuplicateKeepRule>('metadata')
  const keeperOverrides = ref(new Map<number, number>())
  const actionOverrides = ref(new Map<number, BookDuplicateAction | null>())
  const bookActionOverrides = ref(new Map<number, Map<number, BookDuplicateBookAction>>())
  const selectedGroupIds = ref(new Set<number>())
  const allGroupsSelected = ref(false)
  const expandedGroupIds = ref(new Set<number>())
  const dismissals = ref<BookDuplicateDismissal[]>([])
  const loading = ref(false)
  const loaded = ref(false)
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
  const permissions = computed<BookDuplicatePermissions>(() => ({
    canDelete: hasPermission(Permission.LibraryDeleteBooks),
    canMerge: hasPermission(Permission.LibraryMergeBooks),
  }))
  const canUseTool = computed(() => permissions.value.canDelete || permissions.value.canMerge)

  const resolution = useDuplicateResolution(handleResolutionFinished)
  const resolving = computed(() => resolution.running.value)

  /** The keeper a group is currently resolved to: the user's pick, else the active rule's. */
  function keeperIdFor(group: BookDuplicateGroup): number {
    return keeperOverrides.value.get(group.id) ?? recommendKeeper(group, keepRule.value).keeperId
  }

  function mergeAvailabilityFor(group: BookDuplicateGroup): BookDuplicateMergeAvailability {
    return duplicateMergeAvailability(group.books, keeperIdFor(group))
  }

  /** Merge and link need editor access to every book's library; the server refuses the rest. */
  function editsEveryLibrary(group: BookDuplicateGroup): boolean {
    return [...new Set(group.books.map((book) => book.libraryId))].every((libraryId) =>
      hasLibraryPermission(Permission.LibraryMergeBooks, libraryId, 'editor'),
    )
  }

  /** What the user may choose for a group: the permission rule, less what the group itself cannot do (H3, H4, H11). */
  function actionsFor(group: BookDuplicateGroup): BookDuplicateAction[] {
    return allowedDuplicateActions(group.kind, permissions.value).filter((action) => {
      if (action === 'merge') return editsEveryLibrary(group) && mergeAvailabilityFor(group).available
      if (action === 'link') return editsEveryLibrary(group) && duplicateLinkAvailable(group.books)
      return true
    })
  }

  /** The user's pick for a group, else its default; never an action the group no longer allows. */
  function actionFor(group: BookDuplicateGroup): BookDuplicateAction | null {
    const allowed = actionsFor(group)
    const chosen = actionOverrides.value.has(group.id)
      ? (actionOverrides.value.get(group.id) ?? null)
      : defaultDuplicateAction(group, keeperIdFor(group), permissions.value)
    return chosen !== null && allowed.includes(chosen) ? chosen : null
  }

  /** A copy's own action when the user set one in the review (H5), else its group's. */
  function bookActionFor(group: BookDuplicateGroup, bookId: number): BookDuplicateBookAction | null {
    return bookActionOverrides.value.get(group.id)?.get(bookId) ?? actionFor(group)
  }

  const selectedGroups = computed(() => visibleGroups.value.filter((group) => selectedGroupIds.value.has(group.id)))
  /** Every page selected, but more groups match than one resolution takes (it stops at the cap). */
  const allGroupsCapped = computed(() => allGroupsSelected.value && total.value > BOOK_DUPLICATE_RESOLUTION_MAX_GROUPS)
  const selectionGroupCount = computed(() =>
    allGroupsSelected.value ? Math.min(total.value, BOOK_DUPLICATE_RESOLUTION_MAX_GROUPS) : selectedGroupIds.value.size,
  )
  const selectionCopyCount = computed(() => selectedGroups.value.reduce((count, group) => count + group.books.length - 1, 0))
  const selectionBytes = computed(() =>
    selectedGroups.value.reduce((bytes, group) => bytes + (actionFor(group) === 'delete' ? reclaimableBytes(group, keeperIdFor(group)) : 0), 0),
  )
  const allVisibleSelected = computed(
    () => visibleGroups.value.length > 0 && visibleGroups.value.every((group) => selectedGroupIds.value.has(group.id)),
  )
  const canSelectAllGroups = computed(() => allVisibleSelected.value && !allGroupsSelected.value && total.value > visibleGroups.value.length)

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
    actionOverrides.value = new Map()
    bookActionOverrides.value = new Map()
    selectedGroupIds.value = new Set()
    allGroupsSelected.value = false
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
        kind: kind.value,
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
          kind: kind.value,
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
    allGroupsSelected.value = false
    await fetchGroups()
  }

  /** Switches between duplicates and the same book in another format; each is its own list. */
  async function setKind(value: BookDuplicateKind): Promise<void> {
    if (kind.value === value) return
    kind.value = value
    reason.value = undefined
    page.value = 1
    selectedGroupIds.value = new Set()
    allGroupsSelected.value = false
    expandedGroupIds.value = new Set()
    groups.value = []
    loaded.value = false
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
    const books = new Map(bookActionOverrides.value)
    books.delete(groupId)
    bookActionOverrides.value = books
  }

  function setAction(groupId: number, action: BookDuplicateAction | null): void {
    const next = new Map(actionOverrides.value)
    next.set(groupId, action)
    actionOverrides.value = next
    const books = new Map(bookActionOverrides.value)
    books.delete(groupId)
    bookActionOverrides.value = books
  }

  function setBookAction(groupId: number, bookId: number, action: BookDuplicateBookAction): void {
    const next = new Map(bookActionOverrides.value)
    const forGroup = new Map(next.get(groupId) ?? [])
    forGroup.set(bookId, action)
    next.set(groupId, forGroup)
    bookActionOverrides.value = next
  }

  function toggleExpanded(groupId: number): void {
    const next = new Set(expandedGroupIds.value)
    if (next.has(groupId)) next.delete(groupId)
    else next.add(groupId)
    expandedGroupIds.value = next
  }

  function toggleSelected(groupId: number): void {
    allGroupsSelected.value = false
    const next = new Set(selectedGroupIds.value)
    if (next.has(groupId)) next.delete(groupId)
    else next.add(groupId)
    selectedGroupIds.value = next
  }

  function toggleSelectAll(): void {
    allGroupsSelected.value = false
    selectedGroupIds.value = allVisibleSelected.value ? new Set() : new Set(visibleGroups.value.map((group) => group.id))
  }

  /** Extends the selection to every group of the scan, on every page (H8). */
  function selectAllGroups(): void {
    selectedGroupIds.value = new Set(visibleGroups.value.map((group) => group.id))
    allGroupsSelected.value = true
  }

  function clearSelection(): void {
    selectedGroupIds.value = new Set()
    allGroupsSelected.value = false
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

  async function restoreDismissal(bookIdA: number, bookIdB: number, dismissalKind: BookDuplicateKind = 'duplicate'): Promise<void> {
    try {
      await restoreBookDuplicateDismissal(bookIdA, bookIdB, dismissalKind)
      dismissals.value = dismissals.value.filter((entry) => !(entry.bookIdA === bookIdA && entry.bookIdB === bookIdB && entry.kind === dismissalKind))
      toast.success(t('tools.bookDuplicates.dismissed.restored'))
    } catch {
      toast.error(t('tools.bookDuplicates.errors.restore'))
    }
  }

  /**
   * The request for these groups: each group's keeper, action and per-copy choices, plus every
   * other matching group of the scan when the selection spans all pages. Groups listed here are
   * left out of the server's own pass, so a choice made on screen always wins.
   */
  function buildResolution(targets: BookDuplicateGroup[], options: ResolveOptions = {}): BookDuplicateResolutionRequest | null {
    if (!scan.value) return null
    const requested = targets.flatMap((group) => {
      const action = actionFor(group)
      if (!action) return []
      const keeperId = keeperIdFor(group)
      const perBook = group.books
        .filter((book) => book.id !== keeperId)
        .flatMap((book) => {
          const chosen = bookActionOverrides.value.get(group.id)?.get(book.id)
          return chosen && chosen !== action ? [{ bookId: book.id, action: chosen }] : []
        })
      return [{ groupId: group.id, keeperId, action, ...(perBook.length > 0 ? { perBook } : {}) }]
    })
    const request: BookDuplicateResolutionRequest = { scanId: scan.value.id }
    if (requested.length > 0) request.groups = requested
    if (options.allGroups) {
      request.allGroups = {
        kind: kind.value,
        keepRule: keepRule.value,
        ...(reason.value ? { reason: reason.value } : {}),
        excludeGroupIds: [...hiddenGroupIds.value, ...targets.filter((group) => !actionFor(group)).map((group) => group.id)],
      }
    }
    if (options.removeIdenticalCopies && permissions.value.canDelete) request.removeIdenticalCopies = true
    return request.groups || request.allGroups ? request : null
  }

  async function resolveGroups(targets: BookDuplicateGroup[], options: ResolveOptions = {}): Promise<boolean> {
    const request = buildResolution(targets, options)
    if (!request) return false
    return resolution.start(request)
  }

  function handleResolutionFinished(job: BookDuplicateResolutionJob): void {
    clearSelection()
    actionOverrides.value = new Map()
    bookActionOverrides.value = new Map()
    void fetchGroups()
    const count = (status: string) => job.outcomes.filter((outcome) => outcome.status === status).length
    const done = count('done')
    const unresolved = count('failed') + count('partial')
    if (job.status === 'failed') toast.error(t('tools.bookDuplicates.resolution.failed'))
    else if (unresolved > 0) toast.warning(t('tools.bookDuplicates.resolution.partial', { done, total: job.total }))
    else toast.success(t('tools.bookDuplicates.resolution.success', { count: done }, done))
  }

  return {
    scan,
    kind,
    visibleGroups,
    total,
    page,
    pageSize,
    reason,
    sortBy,
    order,
    keepRule,
    keeperOverrides,
    actionOverrides,
    selectedGroupIds,
    allGroupsSelected,
    allGroupsCapped,
    canSelectAllGroups,
    selectionGroupCount,
    expandedGroupIds,
    selectedGroups,
    selectionCopyCount,
    selectionBytes,
    allVisibleSelected,
    dismissals,
    totalPages,
    scanning,
    scanFinished,
    loading,
    loaded,
    error,
    permissions,
    canUseTool,
    resolution,
    resolving,
    keeperIdFor,
    actionFor,
    actionsFor,
    bookActionFor,
    mergeAvailabilityFor,
    startScan,
    resumeActiveScan,
    fetchGroups,
    fetchDismissals,
    setReason,
    setKind,
    setSort,
    setPage,
    setKeepRule,
    setKeeper,
    setAction,
    setBookAction,
    toggleExpanded,
    toggleSelected,
    toggleSelectAll,
    selectAllGroups,
    clearSelection,
    hideGroup,
    dismissGroup,
    restoreDismissal,
    buildResolution,
    resolveGroups,
  }
}
