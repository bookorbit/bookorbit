import { describe, expect, it } from 'vitest'
import type { BookCard } from '@bookorbit/types'
import { getSeriesBookMediaGroupKey, groupSeriesBooksByMedia } from './useSeriesBookMediaGroups'

function makeBook(format: string | null | undefined, overrides: Partial<BookCard> = {}): BookCard {
  return {
    id: 1,
    status: 'present',
    title: 'Series Book',
    authors: [],
    seriesId: 42,
    seriesName: 'The Series',
    seriesIndex: 1,
    files: format === undefined ? [] : [{ id: 1, format, role: 'primary', sizeBytes: null }],
    publishedYear: null,
    language: null,
    genres: [],
    tags: [],
    rating: null,
    readingProgress: null,
    readStatus: null,
    addedAt: '2026-01-01T00:00:00.000Z',
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

describe('series book media groups', () => {
  it.each(['epub', 'pdf', 'mobi', 'azw', 'azw3', 'fb2', 'unknown', null])('groups %s as Books', (format) => {
    expect(getSeriesBookMediaGroupKey(makeBook(format))).toBe('books')
  })

  it.each(['m4b', 'mp3', 'm4a', 'opus', 'ogg', 'flac'])('groups %s as Audiobooks', (format) => {
    expect(getSeriesBookMediaGroupKey(makeBook(format))).toBe('audiobooks')
  })

  it.each(['cbz', 'cbr', 'cb7'])('groups %s as Comics', (format) => {
    expect(getSeriesBookMediaGroupKey(makeBook(format))).toBe('comics')
  })

  it('uses the primary file before secondary files', () => {
    const book = makeBook('epub', {
      files: [
        { id: 1, format: 'mp3', role: 'secondary', sizeBytes: null },
        { id: 2, format: 'epub', role: 'primary', sizeBytes: null },
        { id: 3, format: 'cbz', role: 'secondary', sizeBytes: null },
      ],
    })

    expect(getSeriesBookMediaGroupKey(book)).toBe('books')
  })

  it('uses the first formatted file when no primary file exists', () => {
    const book = makeBook(undefined, {
      files: [
        { id: 1, format: null, role: 'secondary', sizeBytes: null },
        { id: 2, format: 'm4b', role: 'secondary', sizeBytes: null },
      ],
    })

    expect(getSeriesBookMediaGroupKey(book)).toBe('audiobooks')
  })

  it('falls back to Books when files are missing', () => {
    expect(getSeriesBookMediaGroupKey(makeBook(undefined))).toBe('books')
  })

  it('returns ordered groups with matching books', () => {
    const books = [makeBook('mp3', { id: 1 }), makeBook('cbz', { id: 2 }), makeBook('pdf', { id: 3 }), makeBook('epub', { id: 4 })]

    expect(groupSeriesBooksByMedia(books).map((group) => [group.label, group.books.map((book) => book.id)])).toEqual([
      ['Books', [3, 4]],
      ['Audiobooks', [1]],
      ['Comics', [2]],
    ])
  })
})
