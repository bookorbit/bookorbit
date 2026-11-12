import { computed, onScopeDispose, ref } from 'vue'
import { BOOK_REQUEST_BULK_LIMIT, bookRequestActionErrorCode, bookRequestSubmitErrorCode, grabFailureCode } from '@bookorbit/types'
import { api } from '@/lib/api'
import { fulfilmentBase } from '../fulfilmentBase'
import type { RequestListState, RequestListView } from '../requestListQuery'
import type {
  BookRequestItem,
  BookRequestActionErrorCode,
  BookRequestFailureMeta,
  BookRequestMediaKind,
  BookRequestPage,
  BookRequestRequesterOption,
  BookRequestSortDirection,
  BookRequestSortField,
  BookRequestStatus,
  BookRequestSubmitErrorCode,
  BookRequestBulkResult,
  BookRequestSelection,
  BookRequestViewCounts,
  BulkRejectBookRequestsPayload,
  DecideBookRequestPayload,
  FulfillBookRequestPayload,
  GrabBookRequestPayload,
  GrabFailureCode,
  RemoveBookRequestDownloadPayload,
  SelectReleaseUnitPayload,
} from '@bookorbit/types'

export type RequestScope = 'mine' | 'all'

export const REQUEST_PAGE_SIZE = 20

/** Every count the view switcher shows, before the first answer arrives. */
const EMPTY_VIEW_COUNTS: BookRequestViewCounts = {
  active: 0,
  needs_action: 0,
  in_progress: 0,
  finished: 0,
  closed: 0,
  hidden: 0,
  awaitingManualPick: 0,
}

export function useBookRequests(scope: RequestScope) {
  const items = ref<BookRequestItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const view = ref<RequestListView>('all')
  const q = ref('')
  const status = ref<BookRequestStatus | ''>('')
  const mediaKind = ref<BookRequestMediaKind | ''>('')
  const requesterUserId = ref<number | ''>('')
  const requesterOptions = ref<BookRequestRequesterOption[]>([])
  let requesterOptionsInitialized = false
  /** '' is "either", so the control has a third state rather than a checkbox that means two. */
  const selfServe = ref<'' | 'true' | 'false'>('')
  const sortBy = ref<BookRequestSortField>('createdAt')
  const sortDir = ref<BookRequestSortDirection>('desc')
  const loading = ref(false)
  const initialized = ref(false)
  const error = ref<string | null>(null)
  const viewCounts = ref<BookRequestViewCounts>({ ...EMPTY_VIEW_COUNTS })
  const viewCountsLoaded = ref(false)

  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / REQUEST_PAGE_SIZE)))
  const basePath = scope === 'all' ? '/api/v1/admin/book-requests' : '/api/v1/book-requests'

  /**
   * Bumped per list fetch so a slow answer to an earlier question cannot land on a later one.
   *
   * Filters, sorts, pages and every change broadcast all ask this again, so several answers are
   * routinely in flight at once and they do not come back in the order they were asked. Without
   * this the page shows whichever finished last, which is a filter the user has already changed.
   */
  let fetchGeneration = 0
  let countsGeneration = 0
  /**
   * Bumped whenever the page writes a row itself, so a fetch that was already in flight when a
   * decision landed discards its answer instead of putting the old status back.
   */
  let localEdits = 0

  /** The URL state, written onto the refs the fetches read. */
  function applyState(state: RequestListState): void {
    view.value = state.view
    q.value = state.q
    status.value = state.status
    mediaKind.value = state.format
    requesterUserId.value = scope === 'all' ? state.requester : ''
    selfServe.value = state.approval === 'skipped' ? 'true' : state.approval === 'needed' ? 'false' : ''
    sortBy.value = state.sort
    sortDir.value = state.dir
    page.value = state.page
  }

  /** The filters that narrow the list, shared by the list, its counts and "select all matching". */
  function filterParams(): URLSearchParams {
    const query = new URLSearchParams()
    if (q.value) query.set('q', q.value)
    if (status.value) query.set('status', status.value)
    if (mediaKind.value) query.set('mediaKind', mediaKind.value)
    // Only the approver queue accepts a requester filter; the personal list refuses the parameter.
    if (scope === 'all' && requesterUserId.value !== '') query.set('requesterUserId', String(requesterUserId.value))
    if (selfServe.value !== '') query.set('selfServe', selfServe.value)
    return query
  }

  /** The filters plus the section and order, which together name exactly the rows on screen. */
  function listParams(): URLSearchParams {
    const query = filterParams()
    if (view.value !== 'all') query.set('view', view.value)
    query.set('sortBy', sortBy.value)
    query.set('sortDir', sortDir.value)
    // A pair is one row here, led by its ebook, with the audiobook riding along as its companion.
    query.set('groupPairs', 'true')
    return query
  }

  async function fetchRequests(): Promise<void> {
    const generation = ++fetchGeneration
    const edits = localEdits
    loading.value = true
    error.value = null
    const query = listParams()
    query.set('page', String(page.value))
    query.set('limit', String(REQUEST_PAGE_SIZE))

    try {
      const res = await api(`${basePath}?${query}`)
      if (generation !== fetchGeneration) return
      if (!res.ok) {
        error.value = 'loadFailed'
        return
      }
      const payload = (await res.json()) as BookRequestPage
      if (generation !== fetchGeneration || edits !== localEdits) return
      items.value = payload.items
      total.value = payload.total
    } catch {
      if (generation === fetchGeneration) error.value = 'loadFailed'
    } finally {
      // A newer fetch owns the spinner from here, so an older one must not put it away.
      if (generation === fetchGeneration) {
        loading.value = false
        initialized.value = true
      }
    }
  }

  /**
   * How many rows each section holds under the current filters. A failure keeps the last answer:
   * the counts are a guide, and blanking them would make every section look empty.
   */
  async function fetchViewCounts(): Promise<void> {
    const generation = ++countsGeneration
    try {
      const res = await api(`${basePath}/view-counts?${filterParams()}`)
      if (generation !== countsGeneration || !res.ok) return
      const payload = (await res.json()) as BookRequestViewCounts
      if (generation !== countsGeneration) return
      viewCounts.value = payload
      viewCountsLoaded.value = true
    } catch {
      // The list stays usable without counts, and the next change asks again.
    }
  }

  /**
   * Every request behind the current list, not only the page on screen: what "select all matching"
   * acts on. Capped by the server, which says so through `truncated`.
   */
  async function fetchSelection(override: { view?: RequestListView; status?: BookRequestStatus | '' } = {}): Promise<BookRequestSelection | null> {
    const query = listParams()
    if (override.view !== undefined) {
      if (override.view === 'all') query.delete('view')
      else query.set('view', override.view)
    }
    if (override.status !== undefined) {
      if (override.status) query.set('status', override.status)
      else query.delete('status')
    }
    try {
      const res = await api(`${basePath}/selection?${query}`)
      if (!res.ok) return null
      return (await res.json()) as BookRequestSelection
    } catch {
      return null
    }
  }

  /** The requesters the filter offers, fetched once when the tab that has the filter first opens. */
  async function fetchRequesterOptions(): Promise<void> {
    if (scope !== 'all' || requesterOptionsInitialized) return
    try {
      const res = await api('/api/v1/admin/book-requests/requesters')
      if (!res.ok) return
      requesterOptions.value = (await res.json()) as BookRequestRequesterOption[]
      requesterOptionsInitialized = true
    } catch {
      // The request list remains usable and the next tab visit retries this.
    }
  }

  onScopeDispose(() => {
    fetchGeneration += 1
    countsGeneration += 1
  })

  /**
   * Replaces one row in place so a decision does not flash the whole list.
   *
   * The generation moves with it. A list fetch started before the decision is answered with the
   * row as it was, and landing afterwards it would put the old status back for as long as it takes
   * the next fetch to disagree; a decision the user just made must outrank a question asked before
   * it. The broadcast that follows every transition is what fetches the list again.
   */
  function replaceItem(updated: BookRequestItem): void {
    const index = items.value.findIndex((item) => item.id === updated.id)
    if (index !== -1) {
      // A single request comes back flat, so the half it leads keeps the companion it already had.
      items.value.splice(index, 1, { ...updated, companion: items.value[index]!.companion ?? null })
      localEdits++
      return
    }

    const pairIndex = items.value.findIndex((item) => item.companion?.id === updated.id)
    if (pairIndex === -1) return
    items.value.splice(pairIndex, 1, { ...items.value[pairIndex]!, companion: updated })
    localEdits++
  }

  /**
   * Drops a row the list should no longer be holding. The total goes with it, so the pager does
   * not keep claiming a page that is now one row shorter than it says.
   */
  function dropItem(id: number): void {
    const index = items.value.findIndex((item) => item.id === id)
    if (index !== -1) {
      const companion = items.value[index]!.companion
      // The other half of a pair is still a request somebody is waiting on, so it stays as a row
      // of its own rather than leaving with the half that went.
      if (companion) items.value.splice(index, 1, { ...companion, companion: null })
      else {
        items.value.splice(index, 1)
        total.value = Math.max(0, total.value - 1)
      }
      localEdits++
      return
    }

    const pairIndex = items.value.findIndex((item) => item.companion?.id === id)
    if (pairIndex === -1) return
    items.value.splice(pairIndex, 1, { ...items.value[pairIndex]!, companion: null })
    localEdits++
  }

  return {
    items,
    total,
    page,
    pageCount,
    view,
    q,
    status,
    mediaKind,
    requesterUserId,
    requesterOptions,
    selfServe,
    sortBy,
    sortDir,
    loading,
    initialized,
    error,
    viewCounts,
    viewCountsLoaded,
    applyState,
    fetchRequests,
    fetchViewCounts,
    fetchSelection,
    fetchRequesterOptions,
    replaceItem,
    dropItem,
  }
}

/**
 * A rejected action carries the reason in the body, and for a grab that reason is the tracker's own
 * sentence about this one release. Dropping it leaves the operator with a toast that says only that
 * something failed, which for a refusal they could act on is the least useful thing to show.
 */
async function postRequest(path: string, body?: unknown): Promise<ActionOutcome> {
  const res = await api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as {
      message?: string | string[]
      errorCode?: unknown
      errorMeta?: BookRequestFailureMeta
    } | null
    const message = Array.isArray(payload?.message) ? payload.message.join('. ') : payload?.message
    const errorCode =
      grabFailureCode(payload?.errorCode) ?? bookRequestActionErrorCode(payload?.errorCode) ?? bookRequestSubmitErrorCode(payload?.errorCode)
    return {
      item: null,
      reason: message?.trim() ? message.trim() : null,
      errorCode,
      errorMeta: payload?.errorMeta ?? null,
    }
  }
  return { item: (await res.json()) as BookRequestItem, reason: null, errorCode: null, errorMeta: null }
}

/**
 * One action's own outcome.
 *
 * Returned rather than only stashed on the composable, because a row's refusal belongs to that
 * row. Two rows acted on at once used to share one `lastReason`, so whichever call answered last
 * described both and the first row's toast quoted the second row's tracker.
 */
export interface ActionOutcome {
  item: BookRequestItem | null
  reason: string | null
  errorCode: GrabFailureCode | BookRequestActionErrorCode | BookRequestSubmitErrorCode | null
  errorMeta?: BookRequestFailureMeta | null
}

/** The same, for the one action that answers 204 and so has no row to hand back. */
export interface DeleteOutcome {
  ok: boolean
  reason: string | null
}

/** A 204 carries no row to hand back, so success is the absence of a reason rather than an item. */
async function deleteRequest(path: string): Promise<{ ok: boolean; reason: string | null }> {
  const res = await api(path, { method: 'DELETE' })
  if (res.ok) return { ok: true, reason: null }
  const payload = (await res.json().catch(() => null)) as { message?: string | string[] } | null
  const message = Array.isArray(payload?.message) ? payload.message.join('. ') : payload?.message
  return { ok: false, reason: message?.trim() ? message.trim() : null }
}

export function useBookRequestActions(canManage: () => boolean) {
  const basePath = () => fulfilmentBase(canManage())
  /**
   * Every row with an action in flight, not the last one started.
   *
   * A single id could only describe one action at a time, so acting on a second row while the
   * first was still running re-enabled the first row's buttons the moment the second finished -
   * mid-flight, and inviting a second click on work already under way.
   */
  const pendingIds = ref<Set<number>>(new Set())
  /** A batch has no single row to mark busy, so it disables the bulk bar rather than a table row. */
  const bulkPending = ref(false)
  /** Why the last batch was refused, where the server said something worth repeating verbatim. */
  const lastReason = ref<string | null>(null)

  function isPending(id: number | null | undefined): boolean {
    return id != null && pendingIds.value.has(id)
  }

  function markPending(id: number, pending: boolean) {
    const next = new Set(pendingIds.value)
    if (pending) next.add(id)
    else next.delete(id)
    pendingIds.value = next
  }

  async function run(id: number, path: string, body?: unknown): Promise<ActionOutcome> {
    markPending(id, true)
    try {
      return await postRequest(path, body)
    } finally {
      markPending(id, false)
    }
  }

  async function runDelete(id: number, path: string): Promise<DeleteOutcome> {
    markPending(id, true)
    try {
      return await deleteRequest(path)
    } finally {
      markPending(id, false)
    }
  }

  /** One batch request. `null` means the call itself failed, not that nothing was applied. */
  async function postBulk(path: string, payload: BulkRejectBookRequestsPayload): Promise<BookRequestBulkResult | null> {
    const res = await api(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null
      const message = Array.isArray(body?.message) ? body.message.join('. ') : body?.message
      lastReason.value = message?.trim() ? message.trim() : null
      return null
    }
    return (await res.json()) as BookRequestBulkResult
  }

  /**
   * The batch reports per-row outcomes, so `null` here means the call itself failed rather than
   * that nothing was applied. The two need different messages.
   *
   * A selection can be larger than one batch the server accepts, so it goes in slices, one after
   * another, and their outcomes are added up. A slice that fails outright after earlier ones
   * succeeded still reports what landed, with the rest listed as failed.
   */
  async function runBulk(path: string, ids: number[], extra: Omit<BulkRejectBookRequestsPayload, 'ids'> = {}): Promise<BookRequestBulkResult | null> {
    bulkPending.value = true
    lastReason.value = null
    const merged: Required<BookRequestBulkResult> = { updated: [], failed: [], removed: [] }
    try {
      for (let start = 0; start < ids.length; start += BOOK_REQUEST_BULK_LIMIT) {
        const slice = ids.slice(start, start + BOOK_REQUEST_BULK_LIMIT)
        const result = await postBulk(path, { ...extra, ids: slice })
        if (!result) {
          if (start === 0) return null
          merged.failed.push(...ids.slice(start).map((id) => ({ id, title: '', reason: lastReason.value ?? '', errorCode: null, errorMeta: null })))
          break
        }
        merged.updated.push(...result.updated)
        merged.failed.push(...result.failed)
        merged.removed.push(...(result.removed ?? []))
      }
      return merged
    } finally {
      bulkPending.value = false
    }
  }

  const approveMany = (ids: number[]) => runBulk('/api/v1/admin/book-requests/approve', ids)
  const dismissMany = (ids: number[]) => runBulk('/api/v1/book-requests/dismiss', ids)
  const restoreMany = (ids: number[]) => runBulk('/api/v1/book-requests/restore', ids)
  /** Leaving answers with the ids that were left in `removed`, since there is no row to hand back. */
  const leaveMany = (ids: number[]) => runBulk('/api/v1/book-requests/leave', ids)
  /** The server decides per request whether the download client deletes the transfer's files. */
  const cancelMany = (ids: number[]) => runBulk('/api/v1/book-requests/cancel', ids)
  const deleteMany = (ids: number[]) => runBulk('/api/v1/admin/book-requests/delete', ids)
  /** One sentence for the whole selection, since a batch is refused for one reason or none. */
  const rejectMany = (ids: number[], decisionNote?: string) =>
    runBulk('/api/v1/admin/book-requests/reject', ids, decisionNote ? { decisionNote } : {})

  return {
    pendingIds,
    isPending,
    bulkPending,
    lastReason,
    approve: (id: number, body: DecideBookRequestPayload) => run(id, `/api/v1/admin/book-requests/${id}/approve`, body),
    reject: (id: number, body: DecideBookRequestPayload) => run(id, `/api/v1/admin/book-requests/${id}/reject`, body),
    fulfill: (id: number, body: FulfillBookRequestPayload) => run(id, `/api/v1/admin/book-requests/${id}/fulfill`, body),
    // The three a self-server may also call on their own row. Everything above them stays on the
    // admin path, and the UI only offers those to a moderator.
    grab: async (id: number, body: GrabBookRequestPayload) => {
      const outcome = await run(id, `${basePath()}/${id}/grab`, body)
      return { ...outcome, errorCode: grabFailureCode(outcome.errorCode) }
    },
    forceFile: (id: number) => run(id, `${basePath()}/${id}/force-file`),
    /** The other answer to a held import: the release was the wrong book, so throw it away. */
    discardImport: (id: number) => run(id, `${basePath()}/${id}/discard-import`),
    removeDownload: (id: number, downloadId: number, body: RemoveBookRequestDownloadPayload) =>
      run(id, `/api/v1/admin/book-requests/${id}/downloads/${downloadId}/remove`, body),
    selectReleaseUnit: (id: number, downloadId: number, body: SelectReleaseUnitPayload) =>
      run(id, `${basePath()}/${id}/downloads/${downloadId}/select-unit`, body),
    approveMany,
    rejectMany,
    dismissMany,
    restoreMany,
    leaveMany,
    cancelMany,
    deleteMany,
    /** The language the request asks for, which decides which releases can match it at all. */
    setLanguage: (id: number, language: string | null) => run(id, `/api/v1/book-requests/${id}/language`, { language }),
    cancelDownload: (id: number, downloadId: number, body?: RemoveBookRequestDownloadPayload) =>
      run(id, `/api/v1/book-requests/${id}/downloads/${downloadId}/cancel`, body),
    cancel: (id: number, body?: RemoveBookRequestDownloadPayload) => run(id, `/api/v1/book-requests/${id}/cancel`, body),
    dismiss: (id: number) => run(id, `/api/v1/book-requests/${id}/dismiss`),
    restore: (id: number) => run(id, `/api/v1/book-requests/${id}/restore`),
    remove: (id: number, deleteFiles = false) => runDelete(id, `/api/v1/admin/book-requests/${id}${deleteFiles ? '?deleteFiles=true' : ''}`),
    /** Leaving a request somebody else made. 204, so there is no row to hand back afterwards. */
    leave: (id: number) => runDelete(id, `/api/v1/book-requests/${id}/subscription`),
  }
}
