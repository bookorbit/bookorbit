import { describe, expect, it } from 'vitest'
import type { BookCard, BookDetail, LinkedBookSummary } from '@bookorbit/types'
import { bookEditions, cardEditionCount, cardEditionDetail, deleteEditionsChoice, selfEditionSummary } from '../book-editions'

function member(bookId: number, extra: Partial<LinkedBookSummary> = {}): LinkedBookSummary {
  return {
    bookId,
    libraryId: 1,
    libraryName: 'Novels',
    title: 'Jurassic Park',
    formats: ['epub'],
    mediaKind: 'ebook',
    status: 'present',
    isLead: false,
    ...extra,
  }
}

function detail(extra: Partial<BookDetail> = {}): BookDetail {
  return {
    id: 10,
    libraryId: 1,
    libraryName: 'Novels',
    status: 'present',
    title: 'Jurassic Park',
    publisher: 'Ballantine Books',
    publishedYear: 2012,
    files: [
      { id: 1, format: 'EPUB', role: 'content' },
      { id: 2, format: 'm4b', role: 'content' },
      { id: 3, format: 'jpg', role: 'cover' },
    ],
    audioMetadata: null,
    linkIsLead: true,
    linkedBooks: [],
    ...extra,
  } as unknown as BookDetail
}

describe('selfEditionSummary', () => {
  it('uses the server summary when it sends one', () => {
    const self = member(10, { editionName: 'Anniversary' })
    expect(selfEditionSummary(detail({ linkSelf: self }))).toBe(self)
  })

  it('builds the current edition from the detail on older servers', () => {
    expect(selfEditionSummary(detail())).toMatchObject({
      bookId: 10,
      formats: ['epub', 'm4b'],
      mediaKind: 'ebook',
      isLead: true,
      publisher: 'Ballantine Books',
      publishedYear: 2012,
      narrators: [],
    })
  })
})

describe('bookEditions', () => {
  it('is empty for a book with no other edition', () => {
    expect(bookEditions(detail())).toEqual([])
  })

  it('lists the current edition among the others in the shared order, with labels', () => {
    const editions = bookEditions(
      detail({
        linkIsLead: false,
        linkSelf: member(10, { publisher: 'Ballantine Books', publishedYear: 2012, formats: ['epub', 'm4b'] }),
        linkedBooks: [
          member(20, { isLead: true, editionName: 'Full Cast', formats: ['m4b'], libraryName: 'Audiobooks' }),
          member(30, { formats: ['m4b'], narrators: ['Scott Brick'], libraryName: 'Audiobooks', lastReadAt: '2026-11-01T00:00:00Z' }),
        ],
      }),
    )
    expect(editions.map((entry) => [entry.summary.bookId, entry.label, entry.current])).toEqual([
      [20, 'Full Cast', false],
      [30, 'Scott Brick', false],
      [10, 'Ballantine Books · 2012', true],
    ])
  })
})

describe('deleteEditionsChoice', () => {
  it('offers the other editions this user may delete and counts the rest as kept', () => {
    const choice = deleteEditionsChoice(
      detail({
        linkSelf: member(10, { isLead: true, publisher: 'Ballantine Books', publishedYear: 2012, formats: ['epub', 'm4b'] }),
        linkedBooks: [
          member(20, { editionName: 'Full Cast', libraryId: 2, libraryName: 'Audiobooks' }),
          member(30, { editionName: 'Read-along', libraryId: 3, libraryName: 'ReadAloud+' }),
        ],
      }),
      (libraryId) => libraryId !== 3,
    )
    expect(choice).toEqual({
      current: { label: 'Ballantine Books · 2012', formats: ['epub', 'm4b'], libraryName: 'Novels' },
      others: [{ bookId: 20, label: 'Full Cast', libraryName: 'Audiobooks' }],
      kept: 1,
    })
  })

  it('is null for a book with no other edition', () => {
    expect(deleteEditionsChoice(detail(), () => true)).toBeNull()
  })
})

describe('cardEditionCount', () => {
  it('counts the editions a card stands for, and none for a series stack or a lone book', () => {
    const linked = { groupId: 1, memberCount: 3, books: [] }
    expect(cardEditionCount({ linked })).toBe(3)
    expect(cardEditionCount({ linked, collapsedSeries: { bookCount: 4 } as never })).toBe(0)
    expect(cardEditionCount({})).toBe(0)
  })
})

describe('cardEditionDetail', () => {
  function card(extra: Partial<BookCard> = {}): BookCard {
    return {
      id: 4,
      files: [{ id: 40, format: 'M4B', role: 'content' }],
      narrators: ['Ellen Marsh'],
      publisher: 'Brightwave Audio',
      publishedYear: 2023,
      ...extra,
    } as BookCard
  }

  it('names a card by its edition name before anything else', () => {
    expect(cardEditionDetail(card({ editionName: '  Full-cast dramatization ' }))).toBe('Full-cast dramatization')
  })

  it('falls back to the narrator of an audiobook, then publisher and year, then nothing', () => {
    expect(cardEditionDetail(card())).toBe('Ellen Marsh')
    expect(cardEditionDetail(card({ editionName: null, files: [{ id: 41, format: 'epub', role: 'content' }] } as Partial<BookCard>))).toBe(
      'Brightwave Audio · 2023',
    )
    expect(cardEditionDetail(card({ files: [], narrators: [], publisher: null, publishedYear: null }))).toBeNull()
  })
})
