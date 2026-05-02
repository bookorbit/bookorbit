import { describe, expect, it } from 'vitest'
import type { BookCard } from '@bookorbit/types'
import { buildLockStateBookUpdate, mergeBookPatchWithLatest, sameLockFields } from './table-row-state-sync'

function makeBook(overrides: Partial<BookCard> = {}): BookCard {
  return {
    id: 1,
    status: 'ok',
    title: 'Test Book',
    authors: ['Author One'],
    seriesName: null,
    seriesIndex: null,
    files: [],
    publishedYear: 2020,
    language: 'en',
    genres: [],
    tags: [],
    rating: null,
    readingProgress: null,
    readStatus: null,
    addedAt: '2024-01-01T00:00:00Z',
    updatedAt: null,
    metadataScore: null,
    hasCover: false,
    hasMetadataLocks: false,
    lockedFields: [],
    subtitle: null,
    publisher: null,
    pageCount: null,
    isbn13: null,
    narrators: [],
    ...overrides,
  }
}

describe('table-row-state-sync', () => {
  it('merges status patch into latest row snapshot and preserves latest lock fields (regression)', () => {
    const staleBook = makeBook({
      id: 195,
      hasMetadataLocks: false,
      lockedFields: [],
      readStatus: { status: 'reading', source: 'manual', startedAt: null, finishedAt: null, updatedAt: '2024-01-01T00:00:00Z' },
    })
    const latestBook = makeBook({
      id: 195,
      hasMetadataLocks: true,
      lockedFields: ['title'],
      readStatus: { status: 'reading', source: 'manual', startedAt: null, finishedAt: null, updatedAt: '2024-01-02T00:00:00Z' },
    })

    const updated = mergeBookPatchWithLatest([latestBook], staleBook, {
      readStatus: { status: 'skimmed', source: 'manual', startedAt: null, finishedAt: null, updatedAt: '2024-01-03T00:00:00Z' },
    })

    expect(updated.lockedFields).toEqual(['title'])
    expect(updated.hasMetadataLocks).toBe(true)
    expect(updated.readStatus?.status).toBe('skimmed')
  })

  it('returns null for lock-state update when lock fields are unchanged', () => {
    const latestBook = makeBook({
      id: 7,
      hasMetadataLocks: true,
      lockedFields: ['authors', 'title'],
    })

    const updated = buildLockStateBookUpdate([latestBook], latestBook, ['title', 'authors'])
    expect(updated).toBeNull()
  })

  it('builds lock-state row update from latest snapshot', () => {
    const staleBook = makeBook({ id: 9, lockedFields: [], hasMetadataLocks: false, title: 'Stale Title' })
    const latestBook = makeBook({ id: 9, lockedFields: ['title'], hasMetadataLocks: true, title: 'Latest Title' })

    const updated = buildLockStateBookUpdate([latestBook], staleBook, ['title', 'authors'])
    expect(updated).not.toBeNull()
    expect(updated?.title).toBe('Latest Title')
    expect(updated?.lockedFields).toEqual(['title', 'authors'])
    expect(updated?.hasMetadataLocks).toBe(true)
  })

  it('compares lock fields ignoring order', () => {
    expect(sameLockFields(['title', 'authors'], ['authors', 'title'])).toBe(true)
    expect(sameLockFields(['title'], ['authors'])).toBe(false)
  })
})
