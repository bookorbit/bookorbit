import { computed, onScopeDispose, ref, watch } from 'vue'
import { GRAB_FAILURE_CODES } from '@bookorbit/types'
import { api } from '@/lib/api'
import { fulfilmentBase } from '../fulfilmentBase'
import type {
  BookRequestItem,
  BookRequestMediaKind,
  BookRequestPage,
  BookRequestRequesterOption,
  BookRequestSortDirection,
  BookRequestSortField,
  BookRequestStatus,
  BookRequestBulkResult,
  BulkBookRequestsPayload,
  BulkRejectBookRequestsPayload,
  DecideBookRequestPayload,
  FulfillBookRequestPayload,
  GrabBookRequestPayload,
  GrabFailureCode,
  RemoveBookRequestDownloadPayload,
  SelectReleaseUnitPayload,
} from '@bookorbit/types'

export type RequestScope = 'mine' | 'all'

const PAGE_SIZE = 20

/** Typing is a question per keystroke; asking the server once per pause is enough of an answer. */
const REQUESTER_SEARCH_DEBOUNCE_MS = 250

export function useBookRequests(scope: RequestScope) {
  const items = ref<BookRequestItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const status = ref<BookRequestStatus | ''>('')
  const mediaKind = ref<BookRequestMediaKind | ''>('')
  const requesterUserId = ref<number | ''>('')
  const requesterOptions = ref<BookRequestRequesterOption[]>([])
  const requesterSearch = ref('')
  /**
   * Whoever the list is currently filtered on, held separately from the options.
   *
   * The options are one page of an answer to a search, so a narrowing search would otherwise drop
   * the active filter out of its own control and leave a select showing a value it does not list.
   */
  const selectedRequester = ref<BookRequestRequesterOption | null>(null)
  let requesterOptionsInitialized = false
  let requesterSearchHandle: ReturnType<typeof setTimeout> | null = null
  /** Bumped per request so a slow answer to an earlier search cannot land on a later one. */
  let requesterSearchGeneration = 0
  const includeDismissed = ref(false)
  /** '' is "either", so the control has a third state rather than a checkbox that means two. */
  const selfServe = ref<'' | 'true' | 'false'>('')
  const sortBy = ref<BookRequestSortField>('createdAt')
  const sortDir = ref<BookRequestSortDirection>('desc')
  const loading = ref(false)
  const initialized = ref(false)
  const error = ref<string | null>(null)

  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
  const basePath = scope === 'all' ? '/api/v1/admin/book-requests' : '/api/v1/book-requests'

  /**
   * Bumped per list fetch so a slow answer to an earlier question cannot land on a later one.
   *
   * Filters, sorts, pages and every change broadcast all ask this again, so several answers are
   * routinely in flight at once and they do not come back in the order they were asked. Without
   * this the page shows whichever finished last, which is a filter the user has already changed.
   */
  let fetchGeneration = 0
  /**
   * Bumped whenever the page writes a row itself, so a fetch that was already in flight when a
   * decision landed discards its answer instead of putting the old status back.
   */
  let localEdits = 0

  async function fetchRequests(): Promise<void> {
    const generation = ++fetchGeneration
    const edits = localEdits
    loading.value = true
    error.value = null
    const query = new URLSearchParams({ page: String(page.value), limit: String(PAGE_SIZE) })
    if (status.value) query.set('status', status.value)
    if (mediaKind.value) query.set('mediaKind', mediaKind.value)
    // Only the approver queue accepts a requester filter; the personal list refuses the parameter.
    if (scope === 'all' && requesterUserId.value !== '') query.set('requesterUserId', String(requesterUserId.value))
    if (includeDismissed.value) query.set('includeDismissed', 'true')
    if (selfServe.value !== '') query.set('selfServe', selfServe.value)
    query.set('sortBy', sortBy.value)
    query.set('sortDir', sortDir.value)

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
   * The requesters the filter offers: what the current search matched, plus whoever it is already
   * pointed at. The server answers with a bounded page, so the search is what makes somebody past
   * that page reachable rather than silently missing.
   */
  const requesterChoices = computed<BookRequestRequesterOption[]>(() => {
    const selected = selectedRequester.value
    if (!selected || requesterOptions.value.some((option) => option.userId === selected.userId)) return requesterOptions.value
    return [selected, ...requesterOptions.value]
  })

  async function loadRequesterOptions(): Promise<void> {
    const search = requesterSearch.value.trim()
    const generation = ++requesterSearchGeneration
    try {
      const query = search ? `?search=${encodeURIComponent(search)}` : ''
      const res = await api(`/api/v1/admin/book-requests/requesters${query}`)
      if (!res.ok || generation !== requesterSearchGeneration) return
      requesterOptions.value = (await res.json()) as BookRequestRequesterOption[]
      requesterOptionsInitialized = true
    } catch {
      // The request list remains usable and the next keystroke or tab visit retries this.
    }
  }

  /** The first page of requesters, fetched once when the tab that has the filter first opens. */
  async function fetchRequesterOptions(): Promise<void> {
    if (scope !== 'all' || requesterOptionsInitialized) return
    await loadRequesterOptions()
  }

  /** A new search is always a new question, so this asks whatever the first load already did. */
  function searchRequesters(): void {
    if (scope !== 'all') return
    if (requesterSearchHandle) clearTimeout(requesterSearchHandle)
    requesterSearchHandle = setTimeout(() => {
      requesterSearchHandle = null
      void loadRequesterOptions()
    }, REQUESTER_SEARCH_DEBOUNCE_MS)
  }

  // Remembered at the moment of choosing, which is the only moment the option is certain to be in
  // the list: a later search can narrow it out, and the filter still has to name who it is on.
  watch(requesterUserId, (id) => {
    if (id === '') {
      selectedRequester.value = null
      return
    }
    const match = requesterChoices.value.find((option) => option.userId === id)
    if (match) selectedRequester.value = match
  })

  // A tab left mid-keystroke otherwise fires its search into a scope that has gone, and a slow
  // answer lands on refs nothing is rendering.
  onScopeDispose(() => {
    if (requesterSearchHandle) clearTimeout(requesterSearchHandle)
    requesterSearchHandle = null
    requesterSearchGeneration += 1
    fetchGeneration += 1
  })

  /** Filters reset paging: page 3 of the old filter is rarely page 3 of the new one. */
  async function applyFilters(): Promise<void> {
    page.value = 1
    await fetchRequests()
  }

  /**
   * Clicking the column already sorted on flips its direction; a new column starts at the reading
   * most people want first, which is newest for a date and A to Z for everything else.
   */
  async function applySort(field: BookRequestSortField): Promise<void> {
    if (sortBy.value === field) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
    else {
      sortBy.value = field
      sortDir.value = field === 'createdAt' ? 'desc' : 'asc'
    }
    page.value = 1
    await fetchRequests()
  }

  async function goToPage(next: number): Promise<void> {
    const clamped = Math.min(Math.max(1, next), pageCount.value)
    if (clamped === page.value) return
    page.value = clamped
    await fetchRequests()
  }

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
    if (index === -1) return
    items.value.splice(index, 1, updated)
    localEdits++
  }

  /**
   * Drops a row the list should no longer be holding. The total goes with it, so the pager does
   * not keep claiming a page that is now one row shorter than it says.
   */
  function dropItem(id: number): void {
    const index = items.value.findIndex((item) => item.id === id)
    if (index === -1) return
    items.value.splice(index, 1)
    total.value = Math.max(0, total.value - 1)
    localEdits++
  }

  return {
    items,
    total,
    page,
    pageCount,
    status,
    mediaKind,
    requesterUserId,
    requesterOptions: requesterChoices,
    requesterSearch,
    includeDismissed,
    selfServe,
    sortBy,
    sortDir,
    loading,
    initialized,
    error,
    fetchRequests,
    fetchRequesterOptions,
    searchRequesters,
    applyFilters,
    applySort,
    goToPage,
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
    const payload = (await res.json().catch(() => null)) as { message?: string | string[]; errorCode?: string } | null
    const message = Array.isArray(payload?.message) ? payload.message.join('. ') : payload?.message
    return { item: null, reason: message?.trim() ? message.trim() : null, errorCode: grabFailureCodeOf(payload?.errorCode) }
  }
  return { item: (await res.json()) as BookRequestItem, reason: null, errorCode: null }
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
  /** How far a refused grab reaches, which is what lets the picker rule out the rest of a source. */
  errorCode: GrabFailureCode | null
}

/** The same, for the one action that answers 204 and so has no row to hand back. */
export interface DeleteOutcome {
  ok: boolean
  reason: string | null
}

function grabFailureCodeOf(value: unknown): GrabFailureCode | null {
  return typeof value === 'string' && (GRAB_FAILURE_CODES as readonly string[]).includes(value) ? (value as GrabFailureCode) : null
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

  /**
   * The batch reports per-row outcomes, so `null` here means the call itself failed rather than
   * that nothing was applied. The two need different messages.
   */
  async function runBulk(path: string, payload: BulkBookRequestsPayload): Promise<BookRequestBulkResult | null> {
    bulkPending.value = true
    lastReason.value = null
    try {
      const res = await api(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { message?: string | string[] } | null
        const message = Array.isArray(payload?.message) ? payload.message.join('. ') : payload?.message
        lastReason.value = message?.trim() ? message.trim() : null
        return null
      }
      return (await res.json()) as BookRequestBulkResult
    } finally {
      bulkPending.value = false
    }
  }

  const approveMany = (ids: number[]) => runBulk('/api/v1/admin/book-requests/approve', { ids })
  const dismissMany = (ids: number[]) => runBulk('/api/v1/book-requests/dismiss', { ids })
  /** One sentence for the whole selection, since a batch is refused for one reason or none. */
  const rejectMany = (ids: number[], decisionNote?: string) =>
    runBulk('/api/v1/admin/book-requests/reject', { ids, ...(decisionNote ? { decisionNote } : {}) } satisfies BulkRejectBookRequestsPayload)

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
    grab: (id: number, body: GrabBookRequestPayload) => run(id, `${basePath()}/${id}/grab`, body),
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
    /** The language the request asks for, which decides which releases can match it at all. */
    setLanguage: (id: number, language: string | null) => run(id, `/api/v1/book-requests/${id}/language`, { language }),
    cancel: (id: number) => run(id, `/api/v1/book-requests/${id}/cancel`),
    dismiss: (id: number) => run(id, `/api/v1/book-requests/${id}/dismiss`),
    restore: (id: number) => run(id, `/api/v1/book-requests/${id}/restore`),
    remove: (id: number) => runDelete(id, `/api/v1/admin/book-requests/${id}`),
    /** Leaving a request somebody else made. 204, so there is no row to hand back afterwards. */
    leave: (id: number) => runDelete(id, `/api/v1/book-requests/${id}/subscription`),
  }
}
