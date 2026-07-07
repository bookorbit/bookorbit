import { describe, it, expect } from 'vitest'
import type { BookCard, BookDetail } from '@bookorbit/types'
import { mergeBookCardWithDetail, detectChangedColumns } from './book-card-mapper'

function makeBook(overrides: Partial<BookCard> = {}): BookCard {
  return {
    id: 1,
    title: 'Test',
    subtitle: null,
    authors: [],
    genres: [],
    files: [],
    narrators: [],
    customMetadata: [],
    seriesName: null,
    seriesIndex: null,
    seriesMemberships: [],
    rating: null,
    metadataScore: null,
    hasCover: false,
    hasMetadataLocks: false,
    lockedFields: [],
    readStatus: null,
    status: null,
    ...overrides,
  } as BookCard
}

function makeDetail(overrides: Partial<BookDetail> = {}): BookDetail {
  return {
    id: 1,
    libraryId: 1,
    libraryName: 'Test Library',
    status: 'active',
    folderPath: '/books',
    addedAt: '2024-01-01T00:00:00.000Z',
    title: 'Detail Title',
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
    seriesMemberships: [],
    rating: null,
    personalNote: null,
    personalNoteUpdatedAt: null,
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
    lockedFields: [],
    collections: [],
    ...overrides,
  } as BookDetail
}

describe('mergeBookCardWithDetail', () => {
  it('takes scalar fields from detail', () => {
    const book = makeBook()
    const detail = makeDetail({
      status: 'archived',
      title: 'New Title',
      subtitle: 'A Subtitle',
      isbn13: '9781234567890',
      publisher: 'Pub House',
      publishedYear: 2021,
      language: 'en',
      pageCount: 350,
      providerIds: { hardcover: 'new-book-slug' },
      hardcoverEditionId: '8941973',
      seriesName: 'My Series',
      seriesIndex: 2,
      rating: 8,
      metadataScore: 95,
    })

    const result = mergeBookCardWithDetail(book, detail)

    expect(result.status).toBe('archived')
    expect(result.title).toBe('New Title')
    expect(result.subtitle).toBe('A Subtitle')
    expect(result.isbn13).toBe('9781234567890')
    expect(result.publisher).toBe('Pub House')
    expect(result.publishedYear).toBe(2021)
    expect(result.language).toBe('en')
    expect(result.pageCount).toBe(350)
    expect(result.hardcoverId).toBe('new-book-slug')
    expect(result.hardcoverEditionId).toBe('8941973')
    expect(result.seriesName).toBe('My Series')
    expect(result.seriesIndex).toBe(2)
    expect(result.rating).toBe(8)
    expect(result.metadataScore).toBe(95)
  })

  it('maps authors from detail.authors[].name array', () => {
    const book = makeBook()
    const detail = makeDetail({
      authors: [
        { id: 1, name: 'Alice', sortName: null },
        { id: 2, name: 'Bob', sortName: 'Bob, B.' },
      ],
    })

    const result = mergeBookCardWithDetail(book, detail)

    expect(result.authors).toEqual(['Alice', 'Bob'])
  })

  it('maps files to BookFileRef (id, format, role, sizeBytes only)', () => {
    const book = makeBook()
    const detail = makeDetail({
      files: [
        {
          id: 10,
          format: 'epub',
          role: 'primary',
          sizeBytes: 1024,
          absolutePath: '/some/path.epub',
          createdAt: '2024-01-01T00:00:00.000Z',
          filename: 'book.epub',
          durationSeconds: null,
        },
      ],
    })

    const result = mergeBookCardWithDetail(book, detail)

    expect(result.files).toHaveLength(1)
    expect(result.files[0]).toEqual({ id: 10, format: 'epub', role: 'primary', sizeBytes: 1024 })
    expect(result.files[0]).not.toHaveProperty('absolutePath')
    expect(result.files[0]).not.toHaveProperty('filename')
  })

  it('sets hasCover = true when coverSource is non-null', () => {
    const result = mergeBookCardWithDetail(makeBook(), makeDetail({ coverSource: 'extracted' }))
    expect(result.hasCover).toBe(true)
  })

  it('sets hasCover = false when coverSource is null', () => {
    const result = mergeBookCardWithDetail(makeBook(), makeDetail({ coverSource: null }))
    expect(result.hasCover).toBe(false)
  })

  it('sets hasCover = true when coverSource is "custom"', () => {
    const result = mergeBookCardWithDetail(makeBook(), makeDetail({ coverSource: 'custom' }))
    expect(result.hasCover).toBe(true)
  })

  it('sets hasMetadataLocks = true when lockedFields has entries', () => {
    const result = mergeBookCardWithDetail(makeBook(), makeDetail({ lockedFields: ['title'] }))
    expect(result.hasMetadataLocks).toBe(true)
  })

  it('sets hasMetadataLocks = false when lockedFields is empty', () => {
    const result = mergeBookCardWithDetail(makeBook(), makeDetail({ lockedFields: [] }))
    expect(result.hasMetadataLocks).toBe(false)
  })

  it('maps narrators from audioMetadata.narrators[].name', () => {
    const detail = makeDetail({
      audioMetadata: {
        narrators: [
          { id: 1, name: 'Narrator One', sortName: null, displayOrder: 0 },
          { id: 2, name: 'Narrator Two', sortName: null, displayOrder: 1 },
        ],
        durationSeconds: 3600,
        abridged: false,
        chapters: null,
      },
    })

    const result = mergeBookCardWithDetail(makeBook(), detail)

    expect(result.narrators).toEqual(['Narrator One', 'Narrator Two'])
  })

  it('returns empty narrators array when audioMetadata is null', () => {
    const result = mergeBookCardWithDetail(makeBook(), makeDetail({ audioMetadata: null }))
    expect(result.narrators).toEqual([])
  })

  it('returns empty narrators array when audioMetadata is undefined', () => {
    const detail = makeDetail()
    ;(detail as { audioMetadata: unknown }).audioMetadata = undefined
    const result = mergeBookCardWithDetail(makeBook(), detail)
    expect(result.narrators).toEqual([])
  })

  it('preserves fields from the original book that are not overridden', () => {
    const book = makeBook({ id: 42, addedAt: '2023-06-01T00:00:00.000Z' } as Partial<BookCard>)
    const result = mergeBookCardWithDetail(book, makeDetail())
    expect(result.id).toBe(42)
  })
})

describe('detectChangedColumns', () => {
  it('returns empty array when books are identical', () => {
    const a = makeBook({ title: 'Same', authors: ['A'] })
    const b = makeBook({ title: 'Same', authors: ['A'] })
    expect(detectChangedColumns(a, b)).toEqual([])
  })

  it('detects title change', () => {
    const a = makeBook({ title: 'Old' })
    const b = makeBook({ title: 'New' })
    const result = detectChangedColumns(a, b)
    expect(result).toContain('title')
  })

  it('detects authors change', () => {
    const a = makeBook({ authors: ['Alice'] })
    const b = makeBook({ authors: ['Bob'] })
    const result = detectChangedColumns(a, b)
    expect(result).toContain('authors')
  })

  it('detects readStatus change -> adds readStatus and finishedAt', () => {
    const a = makeBook({
      readStatus: { status: 'reading', source: 'manual', startedAt: null, finishedAt: null, updatedAt: '2024-01-01T00:00:00.000Z' },
    })
    const b = makeBook({
      readStatus: {
        status: 'read',
        source: 'manual',
        startedAt: null,
        finishedAt: '2024-06-01T00:00:00.000Z',
        updatedAt: '2024-06-01T00:00:00.000Z',
      },
    })
    const result = detectChangedColumns(a, b)
    expect(result).toContain('readStatus')
    expect(result).toContain('finishedAt')
  })

  it('detects status change -> adds read', () => {
    const a = makeBook({ status: 'active' })
    const b = makeBook({ status: 'archived' })
    const result = detectChangedColumns(a, b)
    expect(result).toContain('read')
  })

  it('detects hasCover change -> adds cover, format, fileSize, read', () => {
    const a = makeBook({ hasCover: false })
    const b = makeBook({ hasCover: true })
    const result = detectChangedColumns(a, b)
    expect(result).toContain('cover')
    expect(result).toContain('format')
    expect(result).toContain('fileSize')
    expect(result).toContain('read')
  })

  it('detects files change -> adds cover, format, fileSize, read', () => {
    const a = makeBook({ files: [] })
    const b = makeBook({ files: [{ id: 1, format: 'epub', role: 'primary', sizeBytes: 512 }] })
    const result = detectChangedColumns(a, b)
    expect(result).toContain('cover')
    expect(result).toContain('format')
    expect(result).toContain('fileSize')
    expect(result).toContain('read')
  })

  it('detects multiple changed fields at once', () => {
    const a = makeBook({ title: 'A', authors: ['X'], rating: null })
    const b = makeBook({ title: 'B', authors: ['Y'], rating: 5 })
    const result = detectChangedColumns(a, b)
    expect(result).toContain('title')
    expect(result).toContain('authors')
    expect(result).toContain('rating')
  })

  describe('sameReadStatus edge cases', () => {
    it('treats same object reference as equal', () => {
      const rs = { status: 'reading' as const, source: 'manual' as const, startedAt: null, finishedAt: null, updatedAt: '2024-01-01T00:00:00.000Z' }
      const a = makeBook({ readStatus: rs })
      const b = makeBook({ readStatus: rs })
      const result = detectChangedColumns(a, b)
      expect(result).not.toContain('readStatus')
    })

    it('treats both null as equal', () => {
      const a = makeBook({ readStatus: null })
      const b = makeBook({ readStatus: null })
      expect(detectChangedColumns(a, b)).not.toContain('readStatus')
    })

    it('detects change when one is null and other is not', () => {
      const a = makeBook({ readStatus: null })
      const b = makeBook({
        readStatus: { status: 'read', source: 'manual', startedAt: null, finishedAt: null, updatedAt: '2024-01-01T00:00:00.000Z' },
      })
      expect(detectChangedColumns(a, b)).toContain('readStatus')
    })

    it('detects change when status strings differ', () => {
      const a = makeBook({
        readStatus: { status: 'reading', source: 'manual', startedAt: null, finishedAt: null, updatedAt: '2024-01-01T00:00:00.000Z' },
      })
      const b = makeBook({
        readStatus: { status: 'read', source: 'manual', startedAt: null, finishedAt: null, updatedAt: '2024-01-01T00:00:00.000Z' },
      })
      expect(detectChangedColumns(a, b)).toContain('readStatus')
    })

    it('detects change when timestamps differ', () => {
      const a = makeBook({
        readStatus: {
          status: 'read',
          source: 'manual',
          startedAt: null,
          finishedAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      })
      const b = makeBook({
        readStatus: {
          status: 'read',
          source: 'manual',
          startedAt: null,
          finishedAt: '2024-06-01T00:00:00.000Z',
          updatedAt: '2024-06-01T00:00:00.000Z',
        },
      })
      expect(detectChangedColumns(a, b)).toContain('readStatus')
    })
  })

  describe('sameStringArray edge cases via detectChangedColumns', () => {
    it('treats empty arrays as equal', () => {
      const a = makeBook({ authors: [] })
      const b = makeBook({ authors: [] })
      expect(detectChangedColumns(a, b)).not.toContain('authors')
    })

    it('detects different lengths as changed', () => {
      const a = makeBook({ authors: ['A'] })
      const b = makeBook({ authors: ['A', 'B'] })
      expect(detectChangedColumns(a, b)).toContain('authors')
    })

    it('detects same length but different values as changed', () => {
      const a = makeBook({ authors: ['A', 'B'] })
      const b = makeBook({ authors: ['A', 'C'] })
      expect(detectChangedColumns(a, b)).toContain('authors')
    })

    it('treats same values in same order as equal', () => {
      const a = makeBook({ authors: ['A', 'B'] })
      const b = makeBook({ authors: ['A', 'B'] })
      expect(detectChangedColumns(a, b)).not.toContain('authors')
    })
  })

  describe('sameFiles edge cases via detectChangedColumns', () => {
    it('treats empty file arrays as equal', () => {
      const a = makeBook({ files: [] })
      const b = makeBook({ files: [] })
      expect(detectChangedColumns(a, b)).not.toContain('cover')
    })

    it('detects file id change', () => {
      const a = makeBook({ files: [{ id: 1, format: 'epub', role: 'primary', sizeBytes: 100 }] })
      const b = makeBook({ files: [{ id: 2, format: 'epub', role: 'primary', sizeBytes: 100 }] })
      expect(detectChangedColumns(a, b)).toContain('cover')
    })

    it('detects file format change', () => {
      const a = makeBook({ files: [{ id: 1, format: 'epub', role: 'primary', sizeBytes: 100 }] })
      const b = makeBook({ files: [{ id: 1, format: 'pdf', role: 'primary', sizeBytes: 100 }] })
      expect(detectChangedColumns(a, b)).toContain('format')
    })

    it('detects file sizeBytes change', () => {
      const a = makeBook({ files: [{ id: 1, format: 'epub', role: 'primary', sizeBytes: 100 }] })
      const b = makeBook({ files: [{ id: 1, format: 'epub', role: 'primary', sizeBytes: 200 }] })
      expect(detectChangedColumns(a, b)).toContain('fileSize')
    })
  })
})
