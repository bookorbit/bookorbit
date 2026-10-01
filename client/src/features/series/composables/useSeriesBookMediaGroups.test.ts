import { describe, expect, it } from 'vitest'
import type { BookCard } from '@bookorbit/types'
import { getSeriesBookMediaGroupKeys, groupSeriesBooksByMedia } from './useSeriesBookMediaGroups'

function makeBook(format: string | null | undefined, overrides: Partial<BookCard> = {}): BookCard {
  return {
    id: 1,
    status: 'present',
    coverAspectRatio: '2/3',
    title: 'Series Book',
    authors: [],
    seriesId: 42,
    seriesName: 'The Series',
    seriesIndex: '1',
    files: format === undefined ? [] : [{ id: 1, format, role: 'primary', sizeBytes: null }],
    publishedDate: null,
    publishedYear: null,
    language: null,
    genres: [],
    tags: [],
    rating: null,
    readingProgress: null,
    readStatus: null,
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    coverVersion: 'legacy:2026-01-01T00:00:00.000Z',
    metadataScore: null,
    hasCover: false,
    hasMetadataLocks: false,
    lockedFields: [],
    subtitle: null,
    publisher: null,
    pageCount: null,
    isbn13: null,
    narrators: [],
    customMetadata: [],
    ...overrides,
  }
}

describe('series book media groups', () => {
  it.each(['epub', 'pdf', 'mobi', 'azw', 'azw3', 'fb2', 'unknown', null])('groups %s as Books', (format) => {
    expect(getSeriesBookMediaGroupKeys(makeBook(format))).toEqual(['books'])
  })

  it.each(['m4b', 'mp3', 'm4a', 'opus', 'ogg', 'flac'])('groups %s as Audiobooks', (format) => {
    expect(getSeriesBookMediaGroupKeys(makeBook(format))).toEqual(['audiobooks'])
  })

  it.each(['cbz', 'cbr', 'cb7'])('groups %s as Comics', (format) => {
    expect(getSeriesBookMediaGroupKeys(makeBook(format))).toEqual(['comics'])
  })

  it('groups a book by every media kind it contains regardless of its primary file', () => {
    const book = makeBook('epub', {
      files: [
        { id: 1, format: 'mp3', role: 'secondary', sizeBytes: null },
        { id: 2, format: 'epub', role: 'primary', sizeBytes: null },
        { id: 3, format: 'cbz', role: 'secondary', sizeBytes: null },
      ],
    })

    expect(getSeriesBookMediaGroupKeys(book)).toEqual(['books', 'audiobooks', 'comics'])
  })

  it('does not add a book to the same group more than once', () => {
    const book = makeBook(undefined, {
      files: [
        { id: 1, format: 'mp3', role: 'primary', sizeBytes: null },
        { id: 2, format: 'm4b', role: 'secondary', sizeBytes: null },
        { id: 3, format: ' M4A ', role: 'secondary', sizeBytes: null },
      ],
    })

    expect(getSeriesBookMediaGroupKeys(book)).toEqual(['audiobooks'])
  })

  it.each([{ files: [] }, { files: [{ id: 1, format: null, role: 'primary', sizeBytes: null }] }])(
    'falls back to Books when no file identifies a media kind',
    ({ files }) => {
      expect(getSeriesBookMediaGroupKeys(makeBook(undefined, { files }))).toEqual(['books'])
    },
  )

  it('returns ordered groups, includes mixed-media books in each match, and preserves input order', () => {
    const books = [
      makeBook('mp3', { id: 1 }),
      makeBook('cbz', { id: 2 }),
      makeBook('epub', {
        id: 3,
        files: [
          { id: 30, format: 'epub', role: 'primary', sizeBytes: null },
          { id: 31, format: 'm4b', role: 'secondary', sizeBytes: null },
        ],
      }),
      makeBook('pdf', {
        id: 4,
        files: [
          { id: 40, format: 'pdf', role: 'primary', sizeBytes: null },
          { id: 41, format: 'flac', role: 'secondary', sizeBytes: null },
          { id: 42, format: 'cbr', role: 'secondary', sizeBytes: null },
        ],
      }),
      makeBook(undefined, { id: 5 }),
    ]

    expect(groupSeriesBooksByMedia(books).map((group) => [group.label, group.books.map((book) => book.id)])).toEqual([
      ['Books', [3, 4, 5]],
      ['Audiobooks', [1, 3, 4]],
      ['Comics', [2, 4]],
    ])
  })
})
