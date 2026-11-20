<script setup lang="ts">
import { computed, onMounted, provide, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { BookPlus, Info, SearchX, TriangleAlert, X } from '@lucide/vue'
import { Permission } from '@bookorbit/types'
import type { BookRequestBulkResult, BookRequestItem, BookRequestSortField } from '@bookorbit/types'
import PageTitleRow from '@/components/page-header/PageTitleRow.vue'
import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useAuth } from '@/features/auth/composables/useAuth'
import { formatCompactNumber, formatNumber } from '@/i18n/formatters'
import { useRouteTab } from '@/composables/useRouteTab'
import { canLeaveSubscription, cancelStopsATransfer } from './requestActions'
import { flattenRequestRows } from './requestPair'
import {
  activeFilterCount,
  defaultSortDirection,
  listStateKey,
  listStateToQuery,
  parseListQuery,
  withoutListQuery,
  type RequestListState,
} from './requestListQuery'
import {
  actionReaches,
  actionTargets,
  bulkActionsFor,
  groupEntriesByRow,
  rowSelectionHalves,
  type BulkActionState,
  type RequestAction,
  type RequestViewer,
  type RowActPayload,
  type RowStep,
  type SelectionHalf,
} from './requestSelection'
import RequestDrawer from './components/RequestDrawer.vue'
import NoRequestSourcesNotice from './components/NoRequestSourcesNotice.vue'
import RequestBulkDock from './components/RequestBulkDock.vue'
import RequestEmptyState from './components/RequestEmptyState.vue'
import RequestListPager from './components/RequestListPager.vue'
import RequestListSkeleton from './components/RequestListSkeleton.vue'
import RequestListTable from './components/RequestListTable.vue'
import RequestListToolbar from './components/RequestListToolbar.vue'
import RequestSearchPanel from './components/RequestSearchPanel.vue'
import RequestSelectionStrip from './components/RequestSelectionStrip.vue'
import { REQUEST_PAGE_SIZE, useBookRequestActions, useBookRequests } from './composables/useBookRequests'
import { useBookRequestProgress } from './composables/useBookRequestProgress'
import { useBookRequestSummary } from './composables/useBookRequestSummary'
import { useRequestSourceStatus } from './composables/useRequestSourceStatus'
import { useCoalescedRefresh } from './composables/useCoalescedRefresh'
import { useRequestListDensity } from './composables/useRequestListDensity'
import { useRequestQueue } from './composables/useRequestQueue'
import { REQUEST_DRAWER } from './requestDrawerContext'
import { localizedRequestActionFailure } from './requestActionFailure'

const TABS = ['search', 'mine', 'all'] as const
type RequestsTab = (typeof TABS)[number]
type BulkCallAction = Exclude<RequestAction, 'pick'>

/** How close together two change broadcasts have to be for the page to answer them once. */
const CHANGE_REFRESH_WINDOW_MS = 400

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { hasPermission } = usePermissions()
const { user } = useAuth()

const canManage = computed(() => hasPermission(Permission.ManageBookRequests))
const canSelfFulfil = computed(() => hasPermission(Permission.BookRequestSelfFulfill))
const canOpenSettings = computed(() => hasPermission(Permission.ManageAppSettings))
const availableTabs = computed<RequestsTab[]>(() => (canManage.value ? [...TABS] : ['search', 'mine']))
const viewer = computed<RequestViewer>(() => ({ userId: user.value?.id ?? null, canManage: canManage.value, canSelfFulfil: canSelfFulfil.value }))

function normalizeTab(value: unknown): RequestsTab {
  return typeof value === 'string' && (TABS as readonly string[]).includes(value) ? (value as RequestsTab) : 'search'
}

const { activeTab } = useRouteTab<RequestsTab>({
  normalize: normalizeTab,
  availableTabs,
  fallback: 'search',
})

const mine = useBookRequests('mine')
const all = useBookRequests('all')
const actions = useBookRequestActions(() => hasPermission(Permission.ManageBookRequests))
const { summary: requestSummary, fetchSummary, refreshSummary } = useBookRequestSummary()
const { noSourcesEnabled, noSourcesConfigured, fetchSourceStatus } = useRequestSourceStatus()
const { density, setDensity } = useRequestListDensity()
const { progressByRequest, onRequestsChanged, pruneSettledProgress } = useBookRequestProgress()

const isListTab = computed(() => activeTab.value !== 'search')
const activeList = computed(() => (activeTab.value === 'all' ? all : mine))
const activeItems = computed(() => activeList.value.items.value)
const tabCounts = computed<Record<RequestsTab, number | null>>(() => ({
  search: null,
  mine: requestSummary.value?.mineTotal ?? null,
  all: canManage.value ? (requestSummary.value?.allTotal ?? null) : null,
}))

/**
 * The list is a function of the URL: view, search, filters, sort and page all live in the query, so
 * a refresh, Back and a shared link land on the same rows. Nothing else writes them.
 */
const listState = computed(() => parseListQuery(route.query, activeTab.value === 'all'))
const listKey = computed(() => `${activeTab.value}|${listStateKey(listState.value)}`)
/** The same, without the page: what a "select all matching" selection is tied to. */
const filterKey = computed(() => `${activeTab.value}|${listStateKey({ ...listState.value, page: 1 })}`)
const hasNarrowing = computed(() => listState.value.q !== '' || activeFilterCount(listState.value) > 0)

function updateList(patch: Partial<RequestListState>) {
  const next = { ...listState.value, ...patch }
  if (!('page' in patch)) next.page = 1
  void router.replace({ query: { ...withoutListQuery(route.query), ...listStateToQuery(next) } })
}

/** A tab is a different list, so it starts from that list's defaults rather than the last one's filters. */
function selectTab(tab: RequestsTab) {
  if (tab === activeTab.value) return
  void router.replace({ query: { ...withoutListQuery(route.query), tab } })
}

/**
 * The open request is whatever the child route names, so the drawer is a function of the URL and
 * nothing else. A hard load of /requests/34 opens it; closing it is a navigation, not local state.
 */
const openRequestId = computed(() => {
  const id = Number(route.params.id)
  return Number.isInteger(id) && id > 0 ? id : null
})
const drawerOpen = computed(() => openRequestId.value !== null)
const drawerLevel = computed<1 | 2>(() => (route.name === 'book-request-releases' ? 2 : 1))

const queue = useRequestQueue(activeItems, openRequestId)
const busyIds = computed(() => actions.pendingIds.value)

async function loadActive() {
  if (activeTab.value === 'search') return
  const list = activeList.value
  list.applyState(listState.value)
  await Promise.all([list.fetchRequests(), list.fetchViewCounts(), activeTab.value === 'all' ? list.fetchRequesterOptions() : Promise.resolve()])
}

function reloadActive() {
  void loadActive()
}

function refreshAfterChange() {
  void loadActive()
  void refreshSummary()
}

onMounted(() => {
  void fetchSummary()
  void fetchSourceStatus()
})

watch(listKey, reloadActive, { immediate: true })

// A status transition is more than a percentage, so the pipeline's coarse signal refetches.
onRequestsChanged(useCoalescedRefresh(refreshAfterChange, CHANGE_REFRESH_WINDOW_MS))

/** A page past the end, after a deletion or a stale link, steps back to the last page there is. */
watch(
  () => [activeList.value.total.value, activeList.value.initialized.value] as const,
  ([total, initialized]) => {
    if (!initialized || !isListTab.value) return
    const last = Math.max(1, Math.ceil(total / REQUEST_PAGE_SIZE))
    if (listState.value.page > last) updateList({ page: last })
  },
)

// ── Selection ────────────────────────────────────────────────────────────────

interface BulkNotice {
  action: BulkCallAction
  done: number
  total: number
  /** Rows still ticked; a pair counts once however many of its halves failed. */
  failed: number
  failures: Array<{ id: number; text: string }>
}

/** After a batch that partly failed: what landed, and why the rest did not. The rest stay ticked. */
const bulkNotice = ref<BulkNotice | null>(null)
const bulkNoticeExpanded = ref(false)

/**
 * Rows, not requests: a pair is one tick. Each entry keeps the halves it stands for as they were
 * last seen, which for a "select all matching" selection includes rows on other pages.
 */
const selection = shallowRef(new Map<number, SelectionHalf[]>())
const selectionMode = ref<'page' | 'matching'>('page')
const matchingTruncated = ref(false)
const selectingAll = ref(false)

const selectedRowIds = computed<ReadonlySet<number>>(() => new Set(selection.value.keys()))
const selectedCount = computed(() => selection.value.size)
const hasSelection = computed(() => selectedCount.value > 0)
const pageSelection = computed<'none' | 'some' | 'all'>(() => {
  const rows = activeItems.value
  const ticked = rows.filter((row) => selection.value.has(row.id)).length
  if (ticked === 0) return 'none'
  return ticked === rows.length ? 'all' : 'some'
})
const offerSelectAll = computed(
  () => selectionMode.value === 'page' && pageSelection.value === 'all' && activeList.value.total.value > activeItems.value.length,
)

function clearSelection() {
  selection.value = new Map()
  selectionMode.value = 'page'
  matchingTruncated.value = false
  bulkNotice.value = null
}

function toggleSelect(row: BookRequestItem) {
  const next = new Map(selection.value)
  if (next.has(row.id)) next.delete(row.id)
  else next.set(row.id, rowSelectionHalves(row, viewer.value.userId))
  selection.value = next
  bulkNotice.value = null
}

function toggleSelectPage() {
  if (pageSelection.value === 'all') {
    if (selectionMode.value === 'matching') {
      clearSelection()
      return
    }
    const next = new Map(selection.value)
    for (const row of activeItems.value) next.delete(row.id)
    selection.value = next
    return
  }
  const next = new Map(selection.value)
  for (const row of activeItems.value) next.set(row.id, rowSelectionHalves(row, viewer.value.userId))
  selection.value = next
  bulkNotice.value = null
}

async function selectAllMatching() {
  selectingAll.value = true
  try {
    const result = await activeList.value.fetchSelection()
    if (!result) {
      toast.error(t('bookRequests.errors.selectAllFailed'))
      return
    }
    selection.value = groupEntriesByRow(result.items)
    selectionMode.value = 'matching'
    matchingTruncated.value = result.truncated
  } finally {
    selectingAll.value = false
  }
}

// A different list is a different selection. Paging keeps a "select all matching" one, since it
// already covers every page, and drops one made by hand on the page being left.
watch(filterKey, clearSelection)
watch(
  () => listState.value.page,
  () => {
    if (selectionMode.value === 'page') clearSelection()
  },
)

/**
 * A refetch can move a ticked row on, so the ones still on screen take their fresh state. A
 * selection made by hand only ever held this page, so a row that left the page leaves it too.
 */
watch(activeItems, (rows) => {
  pruneSettledProgress(flattenRequestRows(rows))
  if (!hasSelection.value) return
  const next = new Map(selection.value)
  const present = new Set<number>()
  for (const row of rows) {
    present.add(row.id)
    if (next.has(row.id)) next.set(row.id, rowSelectionHalves(row, viewer.value.userId))
  }
  if (selectionMode.value === 'page') for (const id of next.keys()) if (!present.has(id)) next.delete(id)
  selection.value = next
})

/** Leave is offered only to someone who joined something here, so it never sits disabled for everyone else. */
const offerLeave = computed(() => {
  const pageHalves = activeItems.value.flatMap((row) => rowSelectionHalves(row, viewer.value.userId))
  const selected = [...selection.value.values()].flat()
  return [...pageHalves, ...selected].some((half) => canLeaveSubscription(half, viewer.value.userId))
})

const bulkActions = computed<BulkActionState[]>(() =>
  bulkActionsFor(listState.value.view, viewer.value, offerLeave.value).map((action) => ({
    action,
    rows: actionTargets(action, selection.value.values(), viewer.value).rows,
  })),
)

// ── Drawer and the pick run ─────────────────────────────────────────────────

interface PickRun {
  /** One entry per row: the half the picker opens on, and every half that belongs to the row. */
  entries: Array<{ id: number; halfIds: number[] }>
  index: number
  picked: number
}

const pickRun = ref<PickRun | null>(null)
const pickRunPosition = computed(() => (pickRun.value ? pickRun.value.index + 1 : 0))
const pickRunTotal = computed(() => pickRun.value?.entries.length ?? 0)

function startPickRun(halves: SelectionHalf[]) {
  const entries = new Map<number, { id: number; halfIds: number[] }>()
  for (const half of halves) {
    const entry = entries.get(half.rowId)
    if (entry) entry.halfIds.push(half.id)
    else entries.set(half.rowId, { id: half.id, halfIds: [half.id] })
  }
  // Every half of the row stays on the run, since the picker hands a pair from one half to the other.
  for (const [rowId, entry] of entries) {
    const selected = selection.value.get(rowId)
    const row = activeItems.value.find((item) => item.id === rowId)
    const halves = selected ?? (row ? rowSelectionHalves(row, viewer.value.userId) : null)
    if (halves) entry.halfIds = [...new Set([...entry.halfIds, ...halves.map((half) => half.id)])]
  }
  if (entries.size === 0) {
    toast.info(t('bookRequests.pickRun.nothing'))
    return
  }
  pickRun.value = { entries: [...entries.values()], index: 0, picked: 0 }
  openReleases(pickRun.value.entries[0]!.id)
}

function moveRun(picked: boolean) {
  const run = pickRun.value
  if (!run) return
  const count = run.picked + (picked ? 1 : 0)
  const index = run.index + 1
  if (index >= run.entries.length) {
    pickRun.value = null
    closeDrawer()
    if (count > 0) toast.success(t('bookRequests.pickRun.done', { count }))
    refreshAfterChange()
    return
  }
  pickRun.value = { ...run, index, picked: count }
  openReleases(run.entries[index]!.id)
}

function advancePickRun(): boolean {
  if (!pickRun.value) return false
  moveRun(true)
  return true
}

function skipPickRun() {
  moveRun(false)
}

// The run follows the picker; stepping to some other request or closing the drawer ends it.
watch(openRequestId, (id) => {
  const run = pickRun.value
  if (!run) return
  if (id === null || !run.entries[run.index]!.halfIds.includes(id)) pickRun.value = null
})

provide(REQUEST_DRAWER, {
  position: queue.position,
  total: queue.total,
  hasPrevious: queue.hasPrevious,
  hasNext: queue.hasNext,
  goPrevious: goToPreviousRequest,
  goNext: goToNextRequest,
  close: closeDrawer,
  pickRun: { position: pickRunPosition, total: pickRunTotal, skip: skipPickRun, advance: advancePickRun },
})

/**
 * A row opens the drawer by naming it in the URL, which is the only place the open id lives. The
 * query rides along on every hop: the tab and the list state live there, and a push that names only
 * the route drops them, so a refresh inside the drawer would land on a different list.
 */
function openRequestById(id: number) {
  void router.push({ name: 'book-request-detail', params: { id }, query: route.query })
}

function openReleases(id: number) {
  void router.push({ name: 'book-request-releases', params: { id }, query: route.query })
}

function closeDrawer() {
  void router.push({ name: 'book-requests', query: route.query })
}

/** Back out of the release picker without losing the request it was opened for. */
function returnToRequest() {
  if (openRequestId.value === null) return
  void router.push({ name: 'book-request-detail', params: { id: openRequestId.value }, query: route.query })
}

function stepTo(id: number | null) {
  if (id !== null) openRequestById(id)
}

function goToPreviousRequest() {
  stepTo(queue.previousId.value)
}

function goToNextRequest() {
  stepTo(queue.nextId.value)
}

// ── Acting on requests ──────────────────────────────────────────────────────

/** The row is gone for good, so both tabs let go of it rather than one keeping a dead id. */
function dropFromLists(id: number) {
  mine.dropItem(id)
  all.dropItem(id)
}

function replaceInLists(item: BookRequestItem) {
  mine.replaceItem(item)
  all.replaceItem(item)
}

function findRequest(id: number): BookRequestItem | null {
  return flattenRequestRows(activeItems.value).find((request) => request.id === id) ?? null
}

const BULK_CALLS: Record<BulkCallAction, (ids: number[], note?: string) => Promise<BookRequestBulkResult | null>> = {
  approve: (ids) => actions.approveMany(ids),
  reject: (ids, note) => actions.rejectMany(ids, note),
  hide: (ids) => actions.dismissMany(ids),
  unhide: (ids) => actions.restoreMany(ids),
  leave: (ids) => actions.leaveMany(ids),
  cancel: (ids) => actions.cancelMany(ids),
  delete: (ids) => actions.deleteMany(ids),
}

const SINGLE_DONE: Record<BulkCallAction, string> = {
  approve: 'bookRequests.toasts.approved',
  reject: 'bookRequests.toasts.rejected',
  hide: 'bookRequests.toasts.dismissed',
  unhide: 'bookRequests.toasts.restored',
  leave: 'bookRequests.toasts.left',
  cancel: 'bookRequests.toasts.cancelled',
  delete: 'bookRequests.toasts.deleted',
}

const MANY_DONE: Record<BulkCallAction, string> = {
  approve: 'bookRequests.toasts.bulkApproved',
  reject: 'bookRequests.toasts.bulkRejected',
  hide: 'bookRequests.toasts.bulkDismissed',
  unhide: 'bookRequests.toasts.bulkUnhidden',
  leave: 'bookRequests.toasts.bulkLeft',
  cancel: 'bookRequests.toasts.bulkCancelled',
  delete: 'bookRequests.toasts.bulkDeleted',
}

const SINGLE_FAILED: Record<BulkCallAction, string> = {
  approve: 'bookRequests.errors.approveFailed',
  reject: 'bookRequests.errors.rejectFailed',
  hide: 'bookRequests.errors.dismissFailed',
  unhide: 'bookRequests.errors.restoreFailed',
  leave: 'bookRequests.errors.leaveFailed',
  cancel: 'bookRequests.errors.cancelFailed',
  delete: 'bookRequests.errors.deleteFailed',
}

const MANY_FAILED: Record<BulkCallAction, string> = {
  approve: 'bookRequests.errors.bulkApproveFailed',
  reject: 'bookRequests.errors.bulkRejectFailed',
  hide: 'bookRequests.errors.bulkDismissFailed',
  unhide: 'bookRequests.errors.bulkRestoreFailed',
  leave: 'bookRequests.errors.bulkLeaveFailed',
  cancel: 'bookRequests.errors.bulkCancelFailed',
  delete: 'bookRequests.errors.bulkDeleteFailed',
}

/** Rows, as the selection bar counts them: both halves of a pair are one. */
function rowCount(halves: SelectionHalf[]): number {
  return new Set(halves.map((half) => half.rowId)).size
}

function rowsAmong(halves: SelectionHalf[], ids: Iterable<number>): number {
  const wanted = new Set(ids)
  return rowCount(halves.filter((half) => wanted.has(half.id)))
}

function failureText(failure: BookRequestBulkResult['failed'][number], halves: SelectionHalf[]): string {
  const localized = localizedRequestActionFailure(failure)
  const reason = localized ? t(localized.key, localized.params) : failure.reason
  const title = failure.title || halves.find((half) => half.id === failure.id)?.title || ''
  return title ? t('bookRequests.bulkResult.failure', { title, reason }) : reason
}

/**
 * One path for every action that has a batch route, whether it came from a row's menu or the bulk
 * bar: the server applies the same rules to one id as to a hundred, and reports each one.
 */
async function executeBulk(action: BulkCallAction, halves: SelectionHalf[], source: 'row' | 'bulk', note?: string) {
  if (halves.length === 0) return
  const ids = halves.map((half) => half.id)
  const result = await BULK_CALLS[action](ids, note)
  const total = rowCount(halves)
  const single = total === 1

  if (!result) {
    const reason = actions.lastReason.value
    toast.error(t(single ? SINGLE_FAILED[action] : MANY_FAILED[action]), reason ? { description: reason } : undefined)
    return
  }

  const view = listState.value.view
  for (const item of result.updated) {
    // A request that was hidden, or brought back, leaves the section it was just in.
    if ((action === 'hide' && view !== 'hidden') || (action === 'unhide' && view === 'hidden')) dropFromLists(item.id)
    else replaceInLists(item)
  }
  for (const id of result.removed ?? []) dropFromLists(id)

  const failedIds = new Set(result.failed.map((failure) => failure.id))
  // A pair landed only when both halves did; one that half failed stays ticked with the rest.
  const done = total - rowsAmong(halves, failedIds)

  if (source === 'bulk') {
    const next = new Map<number, SelectionHalf[]>()
    for (const [rowId, rowHalves] of selection.value) if (rowHalves.some((half) => failedIds.has(half.id))) next.set(rowId, rowHalves)
    selection.value = next
    if (next.size === 0) selectionMode.value = 'page'
  }

  if (result.failed.length === 0) {
    bulkNotice.value = null
    toast.success(single ? t(SINGLE_DONE[action]) : t(MANY_DONE[action], { count: done }))
  } else if (single || source === 'row') {
    const first = result.failed[0]!
    toast.error(t(single ? SINGLE_FAILED[action] : MANY_FAILED[action]), { description: failureText(first, halves) })
  } else {
    bulkNoticeExpanded.value = false
    bulkNotice.value = {
      action,
      done,
      total,
      failed: total - done,
      failures: result.failed.map((failure) => ({ id: failure.id, text: failureText(failure, halves) })),
    }
  }

  refreshAfterChange()
}

/** Approving one request needs a destination; one without goes to the drawer, which can pick one. */
async function approveOne(half: SelectionHalf) {
  const request = findRequest(half.id)
  if (request && request.targetLibraryId === null) {
    openRequestById(half.id)
    return
  }
  if (!request) {
    await executeBulk('approve', [half], 'row')
    return
  }
  const outcome = await actions.approve(request.id, {
    targetLibraryId: request.targetLibraryId!,
    targetFolderId: request.targetFolderId ?? undefined,
  })
  if (!outcome.item) {
    const localized = localizedRequestActionFailure(outcome)
    const description = localized ? t(localized.key, localized.params) : outcome.reason
    toast.error(t('bookRequests.errors.approveFailed'), description ? { description } : undefined)
    return
  }
  replaceInLists(outcome.item)
  toast.success(t('bookRequests.toasts.approved'))
  refreshAfterChange()
}

// ── Confirmations ───────────────────────────────────────────────────────────

interface Confirming {
  action: 'cancel' | 'delete' | 'leave'
  halves: SelectionHalf[]
  source: 'row' | 'bulk'
}

const confirming = ref<Confirming | null>(null)
/** Open while the approver is writing the one reason the whole selection is being turned down for. */
const rejecting = ref<SelectionHalf[] | null>(null)
const rejectNote = ref('')
const rejectCount = computed(() => (rejecting.value ? rowCount(rejecting.value) : 0))

/** The requests on the page behind the dialog, when it is about one row: one request, or both halves of a pair. */
const confirmingRequests = computed(() => {
  const pending = confirming.value
  if (!pending || rowCount(pending.halves) !== 1) return []
  return pending.halves.map((half) => findRequest(half.id)).filter((request): request is BookRequestItem => request !== null)
})
const confirmCount = computed(() => (confirming.value ? rowCount(confirming.value.halves) : 0))

const confirmTitle = computed(() => {
  const count = confirmCount.value
  if (confirming.value?.action === 'delete') return t('bookRequests.confirm.deleteManyTitle', { count })
  if (confirming.value?.action === 'leave') return t('bookRequests.confirm.leaveManyTitle', { count })
  return t('bookRequests.confirm.stopTitle', { count })
})

const confirmDescription = computed(() => {
  const pending = confirming.value
  if (!pending) return ''
  const requests = confirmingRequests.value
  const one = requests.length > 0
  const remoteDelete = requests.some((request) => request.download?.alwaysDeletesRemote ?? false)
  if (pending.action === 'delete') {
    if (!one) return t('bookRequests.confirm.deleteManyDescription')
    return t(remoteDelete ? 'bookRequests.confirm.deleteHideDescriptionRemoteDelete' : 'bookRequests.confirm.deleteHideDescription')
  }
  if (pending.action === 'leave') return t(one ? 'bookRequests.confirm.leaveDescription' : 'bookRequests.confirm.leaveManyDescription')
  if (!one) return t('bookRequests.confirm.stopManyDescription')
  if (requests.some(cancelStopsATransfer)) {
    return t(remoteDelete ? 'bookRequests.confirm.cancelDescriptionWithDownloadRemoteDelete' : 'bookRequests.confirm.cancelDescriptionWithDownload')
  }
  return t('bookRequests.confirm.cancelDescription')
})

const confirmLabel = computed(() => {
  const count = confirmCount.value
  if (confirming.value?.action === 'delete') return t('bookRequests.confirm.deleteConfirm', { count })
  if (confirming.value?.action === 'leave') return t('bookRequests.confirm.leaveConfirm', { count })
  return t('bookRequests.confirm.stopConfirm', { count })
})

const confirmKeepLabel = computed(() =>
  t(confirming.value?.action === 'leave' ? 'bookRequests.confirm.stay' : 'bookRequests.confirm.keep', { count: confirmCount.value }),
)

async function handleConfirm() {
  const pending = confirming.value
  if (!pending) return
  await executeBulk(pending.action, pending.halves, pending.source)
  confirming.value = null
}

function handleConfirmCancel() {
  if (!actions.bulkPending.value) confirming.value = null
}

function handleRejectConfirm() {
  const halves = rejecting.value
  const note = rejectNote.value.trim()
  rejecting.value = null
  if (halves) void executeBulk('reject', halves, 'bulk', note || undefined)
}

function handleRejectCancel() {
  rejecting.value = null
}

/**
 * A row's cancel asks first only when it would stop a live transfer; anything bigger than one
 * request, and every delete or leave, always asks.
 */
function needsConfirm(action: 'cancel' | 'delete' | 'leave', halves: SelectionHalf[], source: 'row' | 'bulk'): boolean {
  if (action !== 'cancel' || source === 'bulk') return true
  return halves.some((half) => {
    const request = findRequest(half.id)
    return request ? cancelStopsATransfer(request) : true
  })
}

function runAction(action: RequestAction, halves: SelectionHalf[], source: 'row' | 'bulk') {
  if (halves.length === 0) return
  switch (action) {
    case 'pick':
      if (source === 'row') openReleases(halves[0]!.id)
      else startPickRun(halves)
      return
    case 'approve':
      if (halves.length === 1 && source === 'row') void approveOne(halves[0]!)
      else void executeBulk('approve', halves, source)
      return
    case 'reject':
      if (source === 'row') void executeBulk('reject', halves, source)
      else {
        rejectNote.value = ''
        rejecting.value = halves
      }
      return
    case 'cancel':
    case 'delete':
    case 'leave':
      if (needsConfirm(action, halves, source)) confirming.value = { action, halves, source }
      else void executeBulk(action, halves, source)
      return
    default:
      void executeBulk(action, halves, source)
  }
}

function handleRowAct(payload: RowActPayload) {
  runAction(payload.action, payload.halves, 'row')
}

function handleRowStep(step: RowStep) {
  if (step.kind === 'review') openRequestById(step.halves[0]!.id)
  else runAction(step.kind, step.halves, 'row')
}

function handleBulkRun(action: RequestAction) {
  bulkNotice.value = null
  runAction(action, actionTargets(action, selection.value.values(), viewer.value).halves, 'bulk')
}

// ── Banner: automation is off ───────────────────────────────────────────────

const awaitingManualPick = computed(() => activeList.value.viewCounts.value.awaitingManualPick)
const showAutomationBanner = computed(
  () =>
    isListTab.value && canManage.value && awaitingManualPick.value > 0 && (listState.value.view === 'all' || listState.value.view === 'needs_action'),
)
const bannerBusy = ref(false)

async function pickAwaitingReleases() {
  bannerBusy.value = true
  try {
    const result = await activeList.value.fetchSelection({ view: 'needs_action', status: 'approved' })
    if (!result) {
      toast.error(t('bookRequests.errors.selectAllFailed'))
      return
    }
    startPickRun(result.items.filter((entry) => actionReaches('pick', entry, viewer.value)))
  } finally {
    bannerBusy.value = false
  }
}

function openRequestSettings() {
  void router.push({ name: 'settings-admin-requests' })
}

// ── Toolbar, sorting, paging ────────────────────────────────────────────────

function handleListChange(patch: Partial<RequestListState>) {
  updateList(patch)
}

/**
 * Clicking the column already sorted on flips its direction; a new column starts at the reading
 * most people want first, which is newest for a date and A to Z for everything else.
 */
function handleSort(field: BookRequestSortField) {
  const current = listState.value
  if (current.sort === field) updateList({ dir: current.dir === 'asc' ? 'desc' : 'asc' })
  else updateList({ sort: field, dir: defaultSortDirection(field) })
}

function handlePage(page: number) {
  updateList({ page })
}

function clearNarrowing() {
  updateList({ q: '', status: '', format: '', requester: '', approval: '' })
}

function handleDensity(next: typeof density.value) {
  setDensity(next)
}

function selectSearchTab() {
  selectTab('search')
}

function handleSubmitted() {
  if (activeTab.value === 'mine') reloadActive()
  void refreshSummary()
}

function dismissBulkNotice() {
  bulkNotice.value = null
}

function toggleBulkNotice() {
  bulkNoticeExpanded.value = !bulkNoticeExpanded.value
}

const emptyTitle = computed(() => {
  if (hasNarrowing.value) return t('bookRequests.list.emptyFiltered')
  const view = listState.value.view
  if (view !== 'all') return t(`bookRequests.list.emptyView.${view}`)
  return activeTab.value === 'all' ? t('bookRequests.list.emptyAll') : t('bookRequests.list.emptyMine')
})

const emptyMessage = computed(() => {
  if (hasNarrowing.value) return t('bookRequests.list.emptyFilteredHint')
  return listState.value.view === 'all' ? t('bookRequests.list.emptyHint') : undefined
})
</script>

<template>
  <div class="mx-auto flex w-full max-w-420 flex-col pt-2 pb-4">
    <PageTitleRow class="mb-4" :icon="BookPlus">
      <template #title>
        <span class="flex min-w-0 items-center gap-2">
          <span class="block truncate text-[19px] leading-[25px] font-bold tracking-[-0.015em] text-foreground sm:text-[22px] sm:leading-[27px]">
            {{ t('bookRequests.pageTitle') }}
          </span>
          <span
            class="inline-flex h-5 shrink-0 items-center rounded-full border border-primary/35 bg-primary/10 px-2 text-[11px] font-semibold tracking-wide text-primary uppercase"
          >
            {{ t('bookRequests.betaTag') }}
          </span>
        </span>
      </template>
      <template #facts>
        <span class="truncate max-md:hidden">{{ t('bookRequests.tagline') }}</span>
      </template>
    </PageTitleRow>

    <!--
      Above the tabs rather than inside one of them: it is the same fact whether you are filing a
      request or waiting on one, and the queue below it is otherwise a list of rows with no stated
      reason for standing still.
    -->
    <NoRequestSourcesNotice v-if="noSourcesEnabled" :nothing-configured="noSourcesConfigured" class="mb-4" />

    <!-- Underline tabs with a roving tabindex, matching the only other tablist in the app. -->
    <div role="tablist" :aria-label="t('bookRequests.pageTitle')" class="mb-4 flex gap-1 border-b border-border">
      <button
        v-for="tab in availableTabs"
        :id="`requests-tab-${tab}`"
        :key="tab"
        type="button"
        role="tab"
        :aria-selected="activeTab === tab"
        :aria-controls="`requests-panel-${tab}`"
        :tabindex="activeTab === tab ? 0 : -1"
        class="-mb-px inline-flex shrink-0 items-center border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none max-sm:px-2.5"
        :class="activeTab === tab ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'"
        @click="selectTab(tab)"
      >
        <span class="sm:hidden">{{ t(`bookRequests.tabsShort.${tab}`) }}</span>
        <span class="max-sm:hidden">{{ t(`bookRequests.tabs.${tab}`) }}</span>
        <template v-if="tabCounts[tab] !== null">
          <span
            class="ms-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/15 px-1.5 text-xs font-semibold text-primary tabular-nums"
            aria-hidden="true"
          >
            {{ formatCompactNumber(tabCounts[tab] ?? 0) }}
          </span>
          <span class="sr-only">{{ formatNumber(tabCounts[tab] ?? 0) }}</span>
        </template>
      </button>
    </div>

    <!--
      The lists want every pixel; this tab is a form and a result list, and stretching a search
      field to the full width only pushes its own submit button away from what you just typed. It
      is capped rather than centred, so switching tabs does not shift the content sideways.
    -->
    <section v-if="activeTab === 'search'" id="requests-panel-search" role="tabpanel" aria-labelledby="requests-tab-search" class="w-full max-w-5xl">
      <RequestSearchPanel @submitted="handleSubmitted" />
    </section>

    <section v-else :id="`requests-panel-${activeTab}`" role="tabpanel" :aria-labelledby="`requests-tab-${activeTab}`" class="space-y-3">
      <RequestListToolbar
        :state="listState"
        :counts="activeList.viewCountsLoaded.value ? activeList.viewCounts.value : null"
        :show-requester="activeTab === 'all'"
        :requester-options="all.requesterOptions.value"
        :density="density"
        @change="handleListChange"
        @update:density="handleDensity"
      />

      <!-- Said once, here, rather than as the same sentence on every approved row below it. -->
      <div
        v-if="showAutomationBanner"
        class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-info/35 bg-info/8 px-3 py-2.5 text-[13px] text-foreground"
        role="status"
      >
        <Info :size="16" class="shrink-0 text-info" aria-hidden="true" />
        <p class="min-w-0 flex-1 basis-60">
          <span class="font-semibold">{{ t('bookRequests.banner.automationOff') }}</span>
          {{ t('bookRequests.banner.needsPick', { count: awaitingManualPick }) }}
        </p>
        <div class="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant="outline" class="h-8 text-[13px]" :disabled="bannerBusy" @click="pickAwaitingReleases">
            {{ t('bookRequests.banner.pick') }}
          </Button>
          <Button v-if="canOpenSettings" size="sm" variant="ghost" class="h-8 text-[13px]" @click="openRequestSettings">
            {{ t('bookRequests.banner.settings') }}
          </Button>
        </div>
      </div>

      <!--
        The skeleton is for a list with nothing on screen yet. A filter change, a page turn and a
        progress tick all refetch, and swapping twenty rows out for six grey bars and back is a
        flash rather than feedback: the rows stay put and go quiet instead.
      -->
      <RequestListSkeleton v-if="!activeList.initialized.value" />

      <!-- A failure with no way out of it leaves reloading the page as the only move. -->
      <div v-else-if="activeList.error.value && activeItems.length === 0" role="alert" class="flex flex-wrap items-center gap-3">
        <p class="text-sm text-destructive">{{ t('bookRequests.errors.loadFailed') }}</p>
        <Button variant="outline" size="sm" :disabled="activeList.loading.value" @click="reloadActive">{{ t('common.retry') }}</Button>
      </div>

      <div v-else-if="activeItems.length === 0" class="rounded-lg border border-border bg-card">
        <RequestEmptyState :icon="hasNarrowing ? SearchX : BookPlus" :title="emptyTitle" :message="emptyMessage">
          <Button v-if="hasNarrowing" size="sm" variant="outline" @click="clearNarrowing">{{ t('bookRequests.list.clearFilters') }}</Button>
          <Button v-else-if="activeTab === 'mine' && listState.view === 'all'" size="sm" @click="selectSearchTab">{{
            t('bookRequests.tabs.search')
          }}</Button>
        </RequestEmptyState>
      </div>

      <div v-else class="overflow-clip rounded-lg border border-border bg-card" :aria-busy="activeList.loading.value">
        <RequestSelectionStrip
          :total="activeList.total.value"
          :selected-count="selectedCount"
          :mode="selectionMode"
          :truncated="matchingTruncated"
          :offer-select-all="offerSelectAll"
          :selecting-all="selectingAll"
          :page-selection="pageSelection"
          :actions="bulkActions"
          :busy="actions.bulkPending.value"
          @toggle-select-page="toggleSelectPage"
          @select-all-matching="selectAllMatching"
          @clear="clearSelection"
          @run="handleBulkRun"
        />

        <div v-if="bulkNotice" role="status" class="border-b border-border bg-warning/8 px-3 py-2 text-[13px]">
          <div class="flex items-start gap-2">
            <TriangleAlert :size="15" class="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
            <p class="min-w-0 flex-1 text-foreground">
              {{
                t(`bookRequests.bulkResult.partial.${bulkNotice.action}`, {
                  done: formatNumber(bulkNotice.done),
                  total: formatNumber(bulkNotice.total),
                  failed: bulkNotice.failed,
                })
              }}
            </p>
            <button
              type="button"
              class="shrink-0 rounded-sm px-1 font-medium text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              :aria-expanded="bulkNoticeExpanded"
              @click="toggleBulkNotice"
            >
              {{ bulkNoticeExpanded ? t('bookRequests.bulkResult.hideWhy') : t('bookRequests.bulkResult.showWhy') }}
            </button>
            <button
              type="button"
              class="-my-0.5 shrink-0 rounded-sm p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              :aria-label="t('bookRequests.bulkResult.dismiss')"
              @click="dismissBulkNotice"
            >
              <X :size="15" aria-hidden="true" />
            </button>
          </div>
          <ul v-if="bulkNoticeExpanded" class="mt-1.5 ms-6 max-h-40 list-disc space-y-0.5 overflow-y-auto ps-4 text-xs text-muted-foreground">
            <li v-for="failure in bulkNotice.failures" :key="failure.id">{{ failure.text }}</li>
          </ul>
        </div>

        <RequestListTable
          class="transition-opacity duration-150 motion-reduce:transition-none"
          :class="activeList.loading.value && 'opacity-60'"
          :requests="activeItems"
          :viewer="viewer"
          :show-requester="activeTab === 'all'"
          :busy-ids="busyIds"
          :progress-by-request="progressByRequest"
          :density="density"
          :sort-by="listState.sort"
          :sort-dir="listState.dir"
          :selected-row-ids="selectedRowIds"
          :page-selection="pageSelection"
          @open="openRequestById"
          @act="handleRowAct"
          @step="handleRowStep"
          @sort="handleSort"
          @toggle-select="toggleSelect"
          @toggle-select-page="toggleSelectPage"
        />

        <RequestListPager
          :page="listState.page"
          :page-size="REQUEST_PAGE_SIZE"
          :total="activeList.total.value"
          :shown="activeItems.length"
          @go="handlePage"
        />
      </div>
    </section>

    <RequestBulkDock
      v-if="isListTab && hasSelection && activeItems.length > 0"
      :selected-count="selectedCount"
      :actions="bulkActions"
      :busy="actions.bulkPending.value"
      @clear="clearSelection"
      @run="handleBulkRun"
    />

    <ConfirmDialog
      :open="confirming !== null"
      :title="confirmTitle"
      :description="confirmDescription"
      :confirm-label="confirmLabel"
      :cancel-label="confirmKeepLabel"
      :busy="actions.bulkPending.value"
      @confirm="handleConfirm"
      @cancel="handleConfirmCancel"
    />

    <!--
      A reason, because a batch is refused for one reason or none and this is the one bulk action
      the people who asked are told about. Optional: "no" with nothing after it is still an answer.
    -->
    <ConfirmDialog
      :open="rejecting !== null"
      :title="t('bookRequests.bulk.rejectTitle', { count: rejectCount })"
      :description="t('bookRequests.confirm.rejectDescription')"
      :confirm-label="t('bookRequests.bulk.rejectConfirm')"
      :cancel-label="t('bookRequests.confirm.goBack')"
      :busy="actions.bulkPending.value"
      @confirm="handleRejectConfirm"
      @cancel="handleRejectCancel"
    >
      <label for="bulk-reject-note" class="mt-4 block text-sm font-medium text-foreground">
        {{ t('bookRequests.bulk.rejectNoteLabel') }}
      </label>
      <textarea
        id="bulk-reject-note"
        v-model="rejectNote"
        rows="3"
        maxlength="2000"
        class="mt-1.5 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        :placeholder="t('bookRequests.bulk.rejectNotePlaceholder')"
      ></textarea>
    </ConfirmDialog>

    <RequestDrawer :open="drawerOpen" :level="drawerLevel" @close="closeDrawer" @back="returnToRequest">
      <router-view />
    </RequestDrawer>
  </div>
</template>
