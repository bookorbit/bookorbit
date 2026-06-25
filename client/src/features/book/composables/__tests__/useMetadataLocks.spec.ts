import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookDetail } from '@bookorbit/types'

import { useMetadataLocks } from '../useMetadataLocks'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<unknown>>())

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

function makeBook(overrides: Partial<BookDetail> = {}): BookDetail {
  return {
    id: 1,
    libraryId: 1,
    libraryName: 'Test Library',
    status: 'present',
    folderPath: '/books',
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    title: 'Test Book',
    subtitle: null,
    description: null,
    isbn10: null,
    isbn13: null,
    publisher: null,
    publishedYear: null,
    language: null,
    pageCount: null,
    seriesName: null,
    seriesIndex: null,
    rating: null,
    communityRatings: [],
    coverSource: null,
    hardcoverEditionId: null,
    providerIds: {},
    authors: [],
    genres: [],
    tags: [],
    files: [],
    lastWrittenAt: null,
    metadataScore: null,
    readStatus: null,
    audioMetadata: null,
    formatPriority: [],
    comicMetadata: null,
    customMetadata: [],
    lockedFields: [],
    collections: [],
    ...overrides,
  }
}

describe('useMetadataLocks', () => {
  beforeEach(() => {
    apiMock.mockReset()
  })

  it('loads current lock state from the book detail', () => {
    const { load, isLocked } = useMetadataLocks()

    load(makeBook({ lockedFields: ['authors', 'cover'] }))

    expect(isLocked('authors')).toBe(true)
    expect(isLocked('cover')).toBe(true)
    expect(isLocked('title')).toBe(false)
  })

  it('toggles a field by replacing the full lock set', async () => {
    const updated = makeBook({ lockedFields: ['title'] })
    apiMock.mockResolvedValue({ ok: true, json: async () => updated })

    const { load, toggle } = useMetadataLocks()
    load(makeBook())
    const result = await toggle(1, 'title')

    const [, req] = apiMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(req.body))).toEqual({ lockedFields: ['title'] })
    expect(result?.lockedFields).toEqual(['title'])
  })

  it('lockAll sends every lockable field', async () => {
    const { BOOK_METADATA_LOCK_FIELDS } = await import('@bookorbit/types')
    const allLocked = makeBook({ lockedFields: [...BOOK_METADATA_LOCK_FIELDS] })
    apiMock.mockResolvedValue({ ok: true, json: async () => allLocked })

    const { lockAll, areAllLocked } = useMetadataLocks()
    const result = await lockAll(1)

    expect(result?.lockedFields).toHaveLength(BOOK_METADATA_LOCK_FIELDS.length)
    expect(areAllLocked.value).toBe(true)
  })

  it('unlockAll sends an empty lock set', async () => {
    const unlocked = makeBook({ lockedFields: [] })
    apiMock.mockResolvedValue({ ok: true, json: async () => unlocked })

    const { load, unlockAll, lockedFields } = useMetadataLocks()
    load(makeBook({ lockedFields: ['title', 'cover'] }))
    const result = await unlockAll(1)

    const [, req] = apiMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(req.body))).toEqual({ lockedFields: [] })
    expect(result?.lockedFields).toEqual([])
    expect(lockedFields.value).toEqual([])
  })

  it('sets error and returns null on network failure', async () => {
    apiMock.mockRejectedValue(new Error('network error'))

    const { toggle, error } = useMetadataLocks()
    const result = await toggle(1, 'title')

    expect(result).toBeNull()
    expect(error.value).toBe('network error')
  })

  it('sets error and returns null on non-ok response', async () => {
    apiMock.mockResolvedValue({ ok: false, status: 409 })

    const { toggle, error } = useMetadataLocks()
    const result = await toggle(1, 'title')

    expect(result).toBeNull()
    expect(error.value).toBe('HTTP 409')
  })

  it('stages lock changes without calling the API in deferred mode', async () => {
    const { load, toggle, isLocked, locksDirty } = useMetadataLocks({ deferred: true })
    load(makeBook())

    await toggle(1, 'goodreadsId')

    expect(apiMock).not.toHaveBeenCalled()
    expect(isLocked('goodreadsId')).toBe(true)
    expect(locksDirty.value).toBe(true)
  })

  it('resets deferred lock changes to the persisted lock state', async () => {
    const { load, toggle, reset, lockedFields, locksDirty } = useMetadataLocks({ deferred: true })
    load(makeBook({ lockedFields: ['title'] }))

    await toggle(1, 'goodreadsId')
    reset()

    expect(lockedFields.value).toEqual(['title'])
    expect(locksDirty.value).toBe(false)
  })

  it('marks deferred lock changes as persisted after a successful combined save', async () => {
    const { load, toggle, markPersisted, lockedFields, locksDirty } = useMetadataLocks({ deferred: true })
    load(makeBook())

    await toggle(1, 'title')
    markPersisted(['title'])

    expect(lockedFields.value).toEqual(['title'])
    expect(locksDirty.value).toBe(false)
  })
})
