import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BookCard, BookMetadataLockField } from '@bookorbit/types'

vi.mock('../useTableLocks', () => ({
  useTableLocks: vi.fn<() => ReturnType<typeof import('../useTableLocks').useTableLocks>>(),
}))

vi.mock('@bookorbit/types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bookorbit/types')>()
  return {
    ...actual,
    isAudioFormat: vi.fn<(fmt: string) => boolean>((fmt) => ['m4b', 'mp3', 'aac', 'm4a'].includes(fmt.toLowerCase())),
  }
})

import { useTableCellHelpers } from '../useTableCellHelpers'
import type { useTableLocks } from '../useTableLocks'

function makeBook(overrides: Partial<BookCard> = {}): BookCard {
  return {
    id: 1,
    status: 'present',
    title: 'Test Book',
    authors: ['Author One'],
    seriesName: null,
    seriesIndex: null,
    files: [],
    publishedYear: null,
    language: null,
    genres: [],
    rating: null,
    readingProgress: null,
    readStatus: null,
    addedAt: '2025-01-01T00:00:00.000Z',
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
    tags: [],
    ...overrides,
  }
}

function makeMockLocks(overrides: Partial<ReturnType<typeof useTableLocks>> = {}): ReturnType<typeof useTableLocks> {
  return {
    locksByBookId: { value: new Map() } as never,
    initBook: vi.fn<(bookId: number, fields: BookMetadataLockField[]) => void>(),
    getFields: vi.fn<(bookId: number) => BookMetadataLockField[]>(() => []),
    isLocked: vi.fn<(bookId: number, field: BookMetadataLockField) => boolean>(() => false),
    isPending: vi.fn<(bookId: number) => boolean>(() => false),
    toggleField: vi.fn<(bookId: number, field: BookMetadataLockField) => Promise<void>>(),
    lockAll: vi.fn<(bookId: number) => Promise<void>>(),
    unlockAll: vi.fn<(bookId: number) => Promise<void>>(),
    resetBook: vi.fn<(bookId: number) => void>(),
    pruneStaleEntries: vi.fn<(activeBookIds: Set<number>) => void>(),
    ...overrides,
  }
}

describe('useTableCellHelpers', () => {
  let locks: ReturnType<typeof useTableLocks>
  let isReadOnly: boolean
  let helpers: ReturnType<typeof useTableCellHelpers>

  beforeEach(() => {
    isReadOnly = false
    locks = makeMockLocks()
    helpers = useTableCellHelpers(locks, () => isReadOnly)
  })

  describe('getCellValue', () => {
    it('returns accessor result for a column with an accessor', () => {
      const book = makeBook({ title: 'Dune' })
      expect(helpers.getCellValue(book, 'title')).toBe('Dune')
    })

    it('returns null for a column without an accessor', () => {
      const book = makeBook()
      expect(helpers.getCellValue(book, 'format')).toBeNull()
    })
  })

  describe('isCellLocked', () => {
    it('returns false for a column without a lockField', () => {
      const book = makeBook()
      expect(helpers.isCellLocked(book, 'format')).toBe(false)
    })

    it('delegates to locks.isLocked for a lockable column', () => {
      const book = makeBook({ id: 42 })
      helpers.isCellLocked(book, 'title')
      expect(locks.isLocked).toHaveBeenCalledWith(42, 'title')
    })

    it('returns true when locks.isLocked returns true', () => {
      locks = makeMockLocks({ isLocked: vi.fn<(bookId: number, field: BookMetadataLockField) => boolean>(() => true) })
      helpers = useTableCellHelpers(locks, () => false)
      expect(helpers.isCellLocked(makeBook(), 'title')).toBe(true)
    })
  })

  describe('isCellReadOnly', () => {
    it('returns true for a non-editable column', () => {
      const book = makeBook()
      expect(helpers.isCellReadOnly(book, { id: 'format', isEditable: false })).toBe(true)
    })

    it('returns true for narrators on a non-audio book', () => {
      const book = makeBook({ files: [{ id: 1, format: 'epub', role: 'primary', sizeBytes: 0 }] })
      expect(helpers.isCellReadOnly(book, { id: 'narrators', isEditable: true })).toBe(true)
    })

    it('returns false for narrators on an audio book when unlocked', () => {
      const book = makeBook({ files: [{ id: 1, format: 'm4b', role: 'primary', sizeBytes: 0 }] })
      locks = makeMockLocks({ isLocked: vi.fn<(bookId: number, field: BookMetadataLockField) => boolean>(() => false) })
      helpers = useTableCellHelpers(locks, () => false)
      expect(helpers.isCellReadOnly(book, { id: 'narrators', isEditable: true })).toBe(false)
    })

    it('returns true when the cell is locked', () => {
      locks = makeMockLocks({ isLocked: vi.fn<(bookId: number, field: BookMetadataLockField) => boolean>(() => true) })
      helpers = useTableCellHelpers(locks, () => false)
      const book = makeBook()
      expect(helpers.isCellReadOnly(book, { id: 'title', isEditable: true })).toBe(true)
    })

    it('returns true when isReadOnly global flag is set', () => {
      isReadOnly = true
      const book = makeBook()
      expect(helpers.isCellReadOnly(book, { id: 'title', isEditable: true })).toBe(true)
    })

    it('returns false for editable, unlocked, non-readonly cell', () => {
      const book = makeBook({ files: [] })
      expect(helpers.isCellReadOnly(book, { id: 'title', isEditable: true })).toBe(false)
    })
  })

  describe('isMandatoryFieldEmpty', () => {
    it('returns true for empty title', () => {
      const book = makeBook({ title: '' })
      expect(helpers.isMandatoryFieldEmpty(book, 'title')).toBe(true)
    })

    it('returns false for non-empty title', () => {
      const book = makeBook({ title: 'Dune' })
      expect(helpers.isMandatoryFieldEmpty(book, 'title')).toBe(false)
    })

    it('returns true for empty authors array', () => {
      const book = makeBook({ authors: [] })
      expect(helpers.isMandatoryFieldEmpty(book, 'authors')).toBe(true)
    })

    it('returns false for non-empty authors', () => {
      const book = makeBook({ authors: ['Frank Herbert'] })
      expect(helpers.isMandatoryFieldEmpty(book, 'authors')).toBe(false)
    })

    it('returns false for non-mandatory columns', () => {
      const book = makeBook({ rating: null })
      expect(helpers.isMandatoryFieldEmpty(book, 'rating')).toBe(false)
    })
  })

  describe('isBookFileMissing', () => {
    it('returns true for status missing', () => {
      expect(helpers.isBookFileMissing(makeBook({ status: 'missing' }))).toBe(true)
    })

    it('returns false for status present', () => {
      expect(helpers.isBookFileMissing(makeBook({ status: 'present' }))).toBe(false)
    })
  })

  describe('getPinnedCellBackground', () => {
    it('returns base background for normal cell', () => {
      const book = makeBook({ title: 'Dune' })
      const bg = helpers.getPinnedCellBackground(book, 'title', false)
      expect(bg).toBe('var(--background)')
    })

    it('returns primary tinted background for selected cell', () => {
      const book = makeBook({ title: 'Dune' })
      const bg = helpers.getPinnedCellBackground(book, 'title', true)
      expect(bg).toContain('var(--primary)')
    })

    it('returns amber tinted background for mandatory empty cell when not selected', () => {
      const book = makeBook({ title: '' })
      const bg = helpers.getPinnedCellBackground(book, 'title', false)
      expect(bg).toContain('oklch')
    })

    it('returns combined background for selected + mandatory empty cell', () => {
      const book = makeBook({ title: '' })
      const bg = helpers.getPinnedCellBackground(book, 'title', true)
      expect(bg).toContain('var(--primary)')
      expect(bg).toContain('oklch')
    })
  })
})
