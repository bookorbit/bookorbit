// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReleaseCandidateItem, ReleaseFileInspection } from '@bookorbit/types'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() }))
vi.mock('@/lib/api', () => ({ api: apiMock }))

import { TITLE_AUTHOR_SEARCH_KEY, useReleasePicker } from '../composables/useReleasePicker'

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

const release = { indexerId: 9, guid: 'release-guid' } as ReleaseCandidateItem

function searchResult(
  overrides: {
    activeIsbn?: string | null
    releases?: ReleaseCandidateItem[]
    uncoveredIndexerCount?: number
    enabledIndexerCount?: number
    configuredIndexerCount?: number
  } = {},
) {
  return {
    releases: overrides.releases ?? [],
    criteria: {
      title: 'Dune',
      authors: ['Frank Herbert'],
      isbn10: null,
      isbn13: null,
      activeIsbn: overrides.activeIsbn ?? null,
      isbns: [],
      mediaKind: 'ebook',
      language: null,
      preferredFormats: ['epub'],
    },
    indexers: [],
    uncoveredIndexerCount: overrides.uncoveredIndexerCount ?? 0,
    enabledIndexerCount: overrides.enabledIndexerCount ?? 1,
    configuredIndexerCount: overrides.configuredIndexerCount ?? 1,
    profileActive: false,
    cached: false,
  }
}
const inspection: ReleaseFileInspection = {
  source: 'torrent_file',
  status: 'ready',
  files: [{ path: 'book.epub', sizeBytes: 1024, bookFile: true }],
  totalFiles: 1,
  primaryFileCount: 1,
  truncated: false,
  units: [{ mediaKind: 'ebook', title: 'Book', contentFileCount: 1, totalFileCount: 1, sizeBytes: 1024 }],
  unitCount: 1,
  ignoredFileCount: 0,
  containerCount: 0,
}

describe('useReleasePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.mockResolvedValue(ok(inspection))
  })

  /**
   * A source that does not carry the requested medium is never searched, so it arrives as a count
   * rather than as a failed indexer. The picker needs it to tell "nothing you have configured
   * carries this" apart from "the search found nothing".
   */
  it('carries the count of sources that were never searched for this medium', async () => {
    apiMock.mockResolvedValue(
      ok({
        releases: [],
        criteria: {
          title: 'Dune',
          authors: ['Frank Herbert'],
          isbn10: null,
          isbn13: null,
          activeIsbn: null,
          isbns: [],
          mediaKind: 'ebook',
          language: null,
          preferredFormats: ['epub'],
        },
        indexers: [],
        uncoveredIndexerCount: 2,
        cached: false,
      }),
    )
    const picker = useReleasePicker(() => true)

    await picker.fetchReleases(42)

    expect(picker.uncoveredIndexerCount.value).toBe(2)
    expect(picker.indexers.value).toEqual([])
    expect(picker.criteria.value?.authors).toEqual(['Frank Herbert'])
  })

  /**
   * Both counts, because zero enabled sources and zero configured sources need opposite fixes and
   * the search result is the only place the picker can learn either: the indexer list is admin-only.
   */
  it('carries how many sources were enabled and how many exist at all', async () => {
    apiMock.mockResolvedValue(ok(searchResult({ enabledIndexerCount: 0, configuredIndexerCount: 3 })))
    const picker = useReleasePicker(() => true)

    await picker.fetchReleases(42)

    expect(picker.enabledIndexerCount.value).toBe(0)
    expect(picker.configuredIndexerCount.value).toBe(3)
  })

  it('posts explicit manual search fields to the scoped fulfillment endpoint', async () => {
    apiMock.mockResolvedValue(
      ok({
        releases: [],
        criteria: {
          title: 'Dune Messiah',
          authors: ['Frank Herbert'],
          isbn10: null,
          isbn13: '9780593098233',
          activeIsbn: '9780593098233',
          isbns: ['9780593098233'],
          mediaKind: 'ebook',
          language: null,
          preferredFormats: ['azw3'],
        },
        indexers: [],
        uncoveredIndexerCount: 0,
        profileActive: false,
        cached: false,
      }),
    )
    const picker = useReleasePicker(() => true)
    const overrides = {
      title: 'Dune Messiah',
      authors: ['Frank Herbert'],
      isbn: '9780593098233',
      language: null,
      preferredFormats: ['azw3'],
    }

    await expect(picker.fetchReleases(42, { overrides })).resolves.toBe(true)

    expect(apiMock).toHaveBeenCalledWith('/api/v1/admin/book-requests/42/releases/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(overrides),
    })
    expect(picker.criteria.value?.isbns).toEqual(['9780593098233'])
  })

  it('forgets the uncovered count and everything it searched when the picker is reset', async () => {
    apiMock.mockResolvedValue(ok(searchResult({ uncoveredIndexerCount: 2 })))
    const picker = useReleasePicker(() => true)
    await picker.fetchReleases(42)

    picker.reset()

    expect(picker.uncoveredIndexerCount.value).toBe(0)
    expect(picker.enabledIndexerCount.value).toBe(0)
    expect(picker.configuredIndexerCount.value).toBe(0)
    expect(picker.criteria.value).toBeNull()
    expect(picker.attempts.value.size).toBe(0)
  })

  /**
   * Alternate ISBNs on one request almost always share a provider label, so "Google Books" four
   * times separates nothing. What each key returned is the only thing that does.
   */
  it('remembers how many releases every key it searched came back with', async () => {
    const picker = useReleasePicker(() => true)

    apiMock.mockResolvedValue(ok(searchResult({ activeIsbn: '9781234567897', releases: [release, release] })))
    await picker.fetchReleases(42)
    apiMock.mockResolvedValue(ok(searchResult({ activeIsbn: '9781250301697' })))
    await picker.fetchReleases(42, { overrides: { isbn: '9781250301697' } })

    expect(picker.attempts.value.get('9781234567897')).toBe(2)
    expect(picker.attempts.value.get('9781250301697')).toBe(0)
  })

  it('keys a title and author search by name, since it has no ISBN to be keyed by', async () => {
    apiMock.mockResolvedValue(ok(searchResult({ activeIsbn: null, releases: [release] })))
    const picker = useReleasePicker(() => true)

    await picker.fetchReleases(42, { overrides: { isbn: null } })

    expect(picker.attempts.value.get(TITLE_AUTHOR_SEARCH_KEY)).toBe(1)
  })

  it('inspects only the selected release without sending source URLs to the browser', async () => {
    const picker = useReleasePicker(() => true)

    await expect(picker.inspectRelease(42, release)).resolves.toEqual(inspection)

    expect(apiMock).toHaveBeenCalledWith('/api/v1/admin/book-requests/42/releases/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ indexerId: 9, releaseGuid: 'release-guid' }),
    })
    expect(picker.inspections.value.get('9:release-guid')).toEqual(inspection)
  })

  it('reuses an inspection until search results are refreshed', async () => {
    const picker = useReleasePicker(() => true)

    await picker.inspectRelease(42, release)
    await picker.inspectRelease(42, release)

    expect(apiMock).toHaveBeenCalledTimes(1)
  })

  it('shares one request when inspection is requested twice at the same time', async () => {
    let resolveInspection!: (response: Response) => void
    apiMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveInspection = resolve
      }),
    )
    const picker = useReleasePicker(() => true)

    const first = picker.inspectRelease(42, release)
    const second = picker.inspectRelease(42, release)
    resolveInspection(ok(inspection))

    await expect(first).resolves.toEqual(inspection)
    await expect(second).resolves.toEqual(inspection)
    expect(apiMock).toHaveBeenCalledTimes(1)
  })

  it('discards an inspection that finishes after search results refresh', async () => {
    let resolveInspection!: (response: Response) => void
    apiMock.mockImplementation((url) => {
      if (url.endsWith('/releases/inspect')) {
        return new Promise<Response>((resolve) => {
          resolveInspection = resolve
        })
      }
      return Promise.resolve(ok({ releases: [], indexers: [], cached: false }))
    })
    const picker = useReleasePicker(() => true)

    const staleInspection = picker.inspectRelease(42, release)
    await picker.fetchReleases(42, { refresh: true })
    resolveInspection(ok(inspection))

    await expect(staleInspection).resolves.toBeNull()
    expect(picker.inspections.value.size).toBe(0)
  })

  it('records a failed inspection and does not invent a manifest', async () => {
    apiMock.mockResolvedValue({ ok: false, status: 502, json: async () => null } as unknown as Response)
    const picker = useReleasePicker(() => true)

    await expect(picker.inspectRelease(42, release)).resolves.toBeNull()

    expect(picker.inspections.value.size).toBe(0)
    expect(picker.inspectionFailed.value.has('9:release-guid')).toBe(true)
  })

  /**
   * The tracker's own sentence is the useful half of a refusal, and it used to be dropped on the
   * floor in favour of "could not read this release's file list".
   */
  it('keeps the reason a refusal came with', async () => {
    apiMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: 'VIP torrent and you are not VIP or higher' }),
    } as unknown as Response)
    const picker = useReleasePicker(() => true)

    await picker.inspectRelease(42, release)

    expect(picker.inspectionFailed.value.get('9:release-guid')).toBe('VIP torrent and you are not VIP or higher')
  })

  it('joins a list of validation messages into one reason', async () => {
    apiMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: ['first', 'second'] }) } as unknown as Response)
    const picker = useReleasePicker(() => true)

    await picker.inspectRelease(42, release)

    expect(picker.inspectionFailed.value.get('9:release-guid')).toBe('first. second')
  })

  /** A transport failure has no sentence to pass on, and must not read as one. */
  it('records no reason when the request never reached the server', async () => {
    apiMock.mockRejectedValue(new Error('offline'))
    const picker = useReleasePicker(() => true)

    await picker.inspectRelease(42, release)

    expect(picker.inspectionFailed.value.has('9:release-guid')).toBe(true)
    expect(picker.inspectionFailed.value.get('9:release-guid')).toBeNull()
  })

  it('clears a previous reason when the same release is inspected again', async () => {
    apiMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'refused' }) } as unknown as Response)
    const picker = useReleasePicker(() => true)
    await picker.inspectRelease(42, release)

    apiMock.mockResolvedValue(ok(inspection))
    picker.reset()
    await picker.inspectRelease(42, release)

    expect(picker.inspectionFailed.value.has('9:release-guid')).toBe(false)
  })
})

/**
 * A cross-indexer search can take the better part of a minute, which is long enough for the
 * approver to search again with different terms, or to leave for another request entirely.
 */
describe('useReleasePicker out-of-order searches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function deferred() {
    let release: (body: unknown) => void = () => {}
    const pending = new Promise<Response>((resolve) => {
      release = (body: unknown) => resolve(ok(body))
    })
    return { pending, release }
  }

  it('does not let an older search overwrite the results of a newer one', async () => {
    const picker = useReleasePicker(() => true)
    const older = deferred()
    const newest = [{ indexerId: 1, guid: 'newest' } as ReleaseCandidateItem]
    apiMock.mockImplementationOnce(() => older.pending)
    apiMock.mockResolvedValueOnce(ok(searchResult({ releases: newest })))

    const stale = picker.fetchReleases(7)
    await picker.fetchReleases(7, { refresh: true })
    older.release(searchResult({ releases: [{ indexerId: 2, guid: 'stale' } as ReleaseCandidateItem] }))

    await expect(stale).resolves.toBe(false)
    expect(picker.releases.value).toEqual(newest)
    expect(picker.loading.value).toBe(false)
  })

  /** Closing the picker resets it, and an answer arriving afterwards is about a request nobody has open. */
  it('does not repopulate a picker that has been reset', async () => {
    const picker = useReleasePicker(() => true)
    const older = deferred()
    apiMock.mockImplementationOnce(() => older.pending)

    const stale = picker.fetchReleases(7)
    picker.reset()
    older.release(searchResult({ releases: [{ indexerId: 2, guid: 'stale' } as ReleaseCandidateItem] }))
    await stale

    expect(picker.releases.value).toEqual([])
    expect(picker.searched.value).toBe(false)
  })
})
