// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn<(...args: [RequestInfo | URL, RequestInit?]) => Promise<unknown>>())

vi.mock('@/lib/api', () => ({ api: apiMock }))

import { DEFAULT_LIST_STATE } from '../requestListQuery'

function response(body: unknown, ok = true): Pick<Response, 'json' | 'ok'> {
  return {
    ok,
    json: vi.fn<() => Promise<unknown>>().mockResolvedValue(body),
  }
}

async function freshActions() {
  vi.resetModules()
  const { useBookRequestActions } = await import('../composables/useBookRequests')
  return useBookRequestActions(() => true)
}

async function freshRequests(scope: 'mine' | 'all') {
  vi.resetModules()
  const { useBookRequests } = await import('../composables/useBookRequests')
  return useBookRequests(scope)
}

describe('useBookRequests filters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends requester, media kind, and every selected status to the paginated endpoint', async () => {
    apiMock.mockResolvedValue(response({ items: [], total: 0 }))
    const requests = await freshRequests('all')
    requests.requesterUserId.value = 42
    requests.mediaKind.value = 'audiobook'
    requests.status.value = 'needs_review'

    await requests.fetchRequests()

    const url = String(apiMock.mock.calls[0]?.[0])
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('requesterUserId')).toBe('42')
    expect(params.get('mediaKind')).toBe('audiobook')
    expect(params.get('status')).toBe('needs_review')
  })

  it('sends the search, the view and the approval filter from the URL state', async () => {
    apiMock.mockResolvedValue(response({ items: [], total: 0 }))
    const requests = await freshRequests('mine')
    requests.applyState({ ...DEFAULT_LIST_STATE, q: 'dune', view: 'hidden', approval: 'skipped', requester: 7, page: 2 })

    await requests.fetchRequests()

    const params = new URLSearchParams(String(apiMock.mock.calls[0]?.[0]).split('?')[1])
    expect(params.get('q')).toBe('dune')
    expect(params.get('view')).toBe('hidden')
    expect(params.get('selfServe')).toBe('true')
    expect(params.get('page')).toBe('2')
    // The personal list refuses a requester filter, so it is never sent from there.
    expect(params.has('requesterUserId')).toBe(false)
    expect(params.has('includeDismissed')).toBe(false)
  })

  it('asks for the view counts with the filters but not the view, sort or page', async () => {
    const counts = { active: 3, needs_action: 1, in_progress: 1, finished: 1, closed: 0, hidden: 5, awaitingManualPick: 0 }
    apiMock.mockResolvedValue(response(counts))
    const requests = await freshRequests('all')
    requests.applyState({ ...DEFAULT_LIST_STATE, q: 'dune', view: 'finished', page: 3 })

    await requests.fetchViewCounts()

    const [path, query] = String(apiMock.mock.calls[0]?.[0]).split('?')
    expect(path).toBe('/api/v1/admin/book-requests/view-counts')
    const params = new URLSearchParams(query)
    expect(params.get('q')).toBe('dune')
    expect(params.has('view')).toBe(false)
    expect(params.has('page')).toBe(false)
    expect(requests.viewCounts.value).toEqual(counts)
  })

  it('asks for every matching request with the same view and order as the list', async () => {
    apiMock.mockResolvedValue(response({ items: [], totalRows: 0, truncated: false }))
    const requests = await freshRequests('mine')
    requests.applyState({ ...DEFAULT_LIST_STATE, view: 'needs_action', sort: 'title', dir: 'asc' })

    await requests.fetchSelection({ status: 'approved' })

    const [path, query] = String(apiMock.mock.calls[0]?.[0]).split('?')
    expect(path).toBe('/api/v1/book-requests/selection')
    const params = new URLSearchParams(query)
    expect(params.get('view')).toBe('needs_action')
    expect(params.get('status')).toBe('approved')
    expect(params.get('sortBy')).toBe('title')
    expect(params.has('page')).toBe(false)
  })

  it('loads requester options once for the all-requests scope', async () => {
    const options = [{ userId: 42, username: 'reader', name: 'Reader' }]
    apiMock.mockResolvedValue(response(options))
    const requests = await freshRequests('all')

    await requests.fetchRequesterOptions()
    await requests.fetchRequesterOptions()

    expect(apiMock).toHaveBeenCalledExactlyOnceWith('/api/v1/admin/book-requests/requesters')
    expect(requests.requesterOptions.value).toEqual(options)
  })

  it('does not load requester options for the caller-scoped list', async () => {
    const requests = await freshRequests('mine')

    await requests.fetchRequesterOptions()

    expect(apiMock).not.toHaveBeenCalled()
  })
})

/**
 * Filters, sorts, pages and every change broadcast all ask the same endpoint again, so several
 * answers are routinely in flight at once and they do not come back in the order they were asked.
 */
describe('useBookRequests out-of-order answers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /** Resolved by hand, so a test can decide which answer arrives second. */
  function deferredResponse(body: unknown, ok = true) {
    let release: () => void = () => {}
    const pending = new Promise((resolve) => {
      release = () => resolve(response(body, ok))
    })
    return { pending, release: () => release() }
  }

  it('does not let a slow answer to an older filter overwrite a newer one', async () => {
    const requests = await freshRequests('mine')
    const stale = deferredResponse({ items: [{ id: 1 }], total: 1 })
    apiMock.mockImplementationOnce(() => stale.pending)
    apiMock.mockImplementationOnce(() => Promise.resolve(response({ items: [{ id: 2 }], total: 1 })))

    const older = requests.fetchRequests()
    requests.applyState({ ...DEFAULT_LIST_STATE, status: 'pending' })
    await requests.fetchRequests()
    stale.release()
    await older

    expect(requests.items.value).toEqual([{ id: 2 }])
    expect(requests.total.value).toBe(1)
  })

  it('leaves the spinner to whichever fetch is newest', async () => {
    const requests = await freshRequests('mine')
    const older = deferredResponse({ items: [], total: 0 })
    const newer = deferredResponse({ items: [], total: 0 })
    apiMock.mockImplementationOnce(() => older.pending)
    apiMock.mockImplementationOnce(() => newer.pending)

    const first = requests.fetchRequests()
    const second = requests.fetchRequests()
    older.release()
    await first

    expect(requests.loading.value).toBe(true)

    newer.release()
    await second
    expect(requests.loading.value).toBe(false)
  })

  /** A page that has just loaded fine must not turn into an error because an older ask failed. */
  it('does not report a stale failure over a newer success', async () => {
    const requests = await freshRequests('mine')
    const older = deferredResponse(null, false)
    apiMock.mockImplementationOnce(() => older.pending)
    apiMock.mockImplementationOnce(() => Promise.resolve(response({ items: [{ id: 2 }], total: 1 })))

    const first = requests.fetchRequests()
    await requests.fetchRequests()
    older.release()
    await first

    expect(requests.error.value).toBeNull()
    expect(requests.items.value).toEqual([{ id: 2 }])
  })
})

/**
 * Two rows are acted on at once whenever the queue is being worked through, and every piece of
 * feedback used to be shared: one `pendingId`, one `lastReason`, one `lastErrorCode`.
 */
describe('useBookRequestActions with more than one row in flight', () => {
  async function freshActions(canManage = true) {
    vi.resetModules()
    const { useBookRequestActions } = await import('../composables/useBookRequests')
    return useBookRequestActions(() => canManage)
  }

  function deferred(body: unknown, ok = true) {
    let release: () => void = () => {}
    const pending = new Promise((resolve) => {
      release = () => resolve(response(body, ok))
    })
    return { pending, release: () => release() }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps a row busy while its own action is in flight', async () => {
    const actions = await freshActions()
    const slow = deferred({ id: 1 })
    apiMock.mockImplementationOnce(() => slow.pending)

    const running = actions.cancel(1)
    expect(actions.isPending(1)).toBe(true)
    expect(actions.isPending(2)).toBe(false)

    slow.release()
    await running
    expect(actions.isPending(1)).toBe(false)
  })

  it('cancels only the named download through the requester-scoped route', async () => {
    const actions = await freshActions()
    apiMock.mockResolvedValue(response({ id: 1, status: 'approved' }))

    await actions.cancelDownload(1, 11)

    expect(apiMock).toHaveBeenCalledExactlyOnceWith('/api/v1/book-requests/1/downloads/11/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
  })

  it('sends explicit file-deletion consent for irreversible clients', async () => {
    const actions = await freshActions()
    apiMock.mockResolvedValue(response({ id: 1, status: 'cancelled' }))

    await actions.cancel(1, { deleteFiles: true })
    await actions.cancelDownload(1, 11, { deleteFiles: true })
    await actions.remove(1, true)

    expect(apiMock).toHaveBeenNthCalledWith(1, '/api/v1/book-requests/1/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"deleteFiles":true}',
    })
    expect(apiMock).toHaveBeenNthCalledWith(2, '/api/v1/book-requests/1/downloads/11/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"deleteFiles":true}',
    })
    expect(apiMock).toHaveBeenNthCalledWith(3, '/api/v1/admin/book-requests/1?deleteFiles=true', { method: 'DELETE' })
  })

  /**
   * The single id described only the last action started, so finishing row B re-enabled row A's
   * buttons while A's own call was still running.
   */
  it('does not un-busy the first row when a second row finishes first', async () => {
    const actions = await freshActions()
    const slow = deferred({ id: 1 })
    apiMock.mockImplementationOnce(() => slow.pending)
    apiMock.mockImplementationOnce(() => Promise.resolve(response({ id: 2 })))

    const first = actions.cancel(1)
    await actions.cancel(2)

    expect(actions.isPending(1)).toBe(true)
    slow.release()
    await first
    expect(actions.isPending(1)).toBe(false)
  })

  /** One row's refusal must not reach the other row's toast. */
  it('returns each refusal to the call it belongs to', async () => {
    const actions = await freshActions()
    const slow = deferred({ message: 'the tracker refused this release' }, false)
    apiMock.mockImplementationOnce(() => slow.pending)
    apiMock.mockImplementationOnce(() => Promise.resolve(response({ message: 'that request is already cancelled' }, false)))

    const first = actions.cancel(1)
    const second = await actions.cancel(2)
    slow.release()

    expect((await first).reason).toBe('the tracker refused this release')
    expect(second.reason).toBe('that request is already cancelled')
  })

  it('carries the grab failure code back with the grab it classified', async () => {
    const actions = await freshActions()
    apiMock.mockResolvedValue(response({ message: 'the tracker answered 406', errorCode: 'GRAB_SOURCE_REFUSED' }, false))

    const outcome = await actions.grab(1, { indexerId: 9, releaseGuid: 'g1' })

    expect(outcome).toMatchObject({ item: null, errorCode: 'GRAB_SOURCE_REFUSED', reason: 'the tracker answered 406' })
  })

  it('reports a deletion refusal on the call rather than on the composable', async () => {
    const actions = await freshActions()
    apiMock.mockResolvedValue(response({ message: 'remove the download from its client first' }, false))

    await expect(actions.remove(1)).resolves.toEqual({ ok: false, reason: 'remove the download from its client first' })
  })
})

describe('useBookRequests pairs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const ebook = { id: 10, mediaKind: 'ebook', status: 'pending', companionRequestId: 11 }
  const audiobook = { id: 11, mediaKind: 'audiobook', status: 'pending', companionRequestId: 10 }

  it('asks for a pair as one row', async () => {
    apiMock.mockResolvedValue(response({ items: [], total: 0 }))
    const requests = await freshRequests('mine')

    await requests.fetchRequests()

    const params = new URLSearchParams(String(apiMock.mock.calls[0]?.[0]).split('?')[1])
    expect(params.get('groupPairs')).toBe('true')
  })

  it('updates the half a decision was about, whichever half leads the row', async () => {
    apiMock.mockResolvedValue(response({ items: [{ ...ebook, companion: audiobook }], total: 1 }))
    const requests = await freshRequests('mine')
    await requests.fetchRequests()

    requests.replaceItem({ ...audiobook, status: 'approved' } as never)
    expect(requests.items.value[0]!.companion?.status).toBe('approved')

    // A single request comes back flat, so the lead keeps the companion it already had.
    requests.replaceItem({ ...ebook, status: 'approved' } as never)
    expect(requests.items.value[0]!.status).toBe('approved')
    expect(requests.items.value[0]!.companion?.id).toBe(11)
  })

  it('keeps the other half of a pair on the list when one half leaves it', async () => {
    apiMock.mockResolvedValue(response({ items: [{ ...ebook, companion: audiobook }], total: 1 }))
    const requests = await freshRequests('mine')
    await requests.fetchRequests()

    requests.dropItem(10)

    expect(requests.items.value).toHaveLength(1)
    expect(requests.items.value[0]!.id).toBe(11)
    expect(requests.items.value[0]!.companion).toBeNull()
    expect(requests.total.value).toBe(1)

    requests.dropItem(11)
    expect(requests.items.value).toHaveLength(0)
    expect(requests.total.value).toBe(0)
  })
})

describe('useBookRequestActions batches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends a selection larger than one batch in slices and adds up what came back', async () => {
    const actions = await freshActions()
    apiMock.mockImplementation((_path, init) => {
      const { ids } = JSON.parse(String(init?.body)) as { ids: number[] }
      return Promise.resolve(response({ updated: [], failed: [], removed: ids }))
    })
    const ids = Array.from({ length: 230 }, (_, index) => index + 1)

    const result = await actions.deleteMany(ids)

    expect(apiMock).toHaveBeenCalledTimes(3)
    expect(String(apiMock.mock.calls[0]?.[0])).toBe('/api/v1/admin/book-requests/delete')
    expect(result?.removed).toHaveLength(230)
    expect(actions.bulkPending.value).toBe(false)
  })

  it('reports the rest as failed when a later slice is refused outright', async () => {
    const actions = await freshActions()
    apiMock
      .mockImplementationOnce(() => Promise.resolve(response({ updated: [], failed: [], removed: [] })))
      .mockImplementationOnce(() => Promise.resolve(response({ message: 'Too many' }, false)))
    const ids = Array.from({ length: 150 }, (_, index) => index + 1)

    const result = await actions.cancelMany(ids)

    expect(String(apiMock.mock.calls[0]?.[0])).toBe('/api/v1/book-requests/cancel')
    expect(result?.failed).toHaveLength(50)
    expect(result?.failed[0]).toMatchObject({ id: 101, reason: 'Too many' })
  })

  it('reports a batch refused at once as a failed call', async () => {
    const actions = await freshActions()
    apiMock.mockResolvedValueOnce(response({ message: 'Nope' }, false))

    expect(await actions.leaveMany([1, 2])).toBeNull()
    expect(actions.lastReason.value).toBe('Nope')
  })
})
