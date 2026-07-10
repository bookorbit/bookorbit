import { describe, expect, it, vi } from 'vitest'
import type { BookCard, CustomMetadataFieldSummary } from '@bookorbit/types'

vi.mock('@/lib/formatting', () => ({
  formatBytes: vi.fn<(bytes: number | null) => string>((bytes) => `formatted:${bytes}`),
}))

import { formatBytes } from '@/lib/formatting'
import {
  COLUMN_DEFS,
  COLUMN_DEF_MAP,
  DEFAULT_HIDDEN,
  DEFAULT_ORDER,
  DEFAULT_WIDTHS,
  LOCK_ROW_COLUMN_DEF,
  buildCustomColumnDef,
  isCustomColumnId,
  parseCustomFieldId,
} from '../tableColumnSchema'

function makeField(overrides: Partial<CustomMetadataFieldSummary> = {}): CustomMetadataFieldSummary {
  return {
    id: 42,
    label: 'My Field',
    type: 'text',
    displayOrder: 0,
    archivedAt: null,
    enabledLibraryIds: [1],
    ...overrides,
  }
}

function makeBook(overrides: Partial<BookCard> = {}): BookCard {
  return {
    id: 1,
    status: 'present',
    title: 'Dune',
    authors: [],
    seriesName: null,
    seriesIndex: null,
    files: [],
    publishedDate: null,
    publishedYear: null,
    language: null,
    genres: [],
    rating: null,
    readingProgress: null,
    readStatus: null,
    addedAt: '2025-01-01T00:00:00Z',
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
    customMetadata: [],
    ...overrides,
  }
}

describe('tableColumnSchema', () => {
  it('exposes 27 total column definitions including the lock row', () => {
    expect([LOCK_ROW_COLUMN_DEF, ...COLUMN_DEFS]).toHaveLength(27)
  })

  it('builds a map entry for every column definition in COLUMN_DEFS', () => {
    expect(COLUMN_DEF_MAP.size).toBe(COLUMN_DEFS.length)
    for (const column of COLUMN_DEFS) {
      expect(COLUMN_DEF_MAP.get(column.id)).toBe(column)
    }
  })

  it('defines the lock row as a left pinned column', () => {
    expect(LOCK_ROW_COLUMN_DEF.id).toBe('lockRow')
    expect(LOCK_ROW_COLUMN_DEF.pinned).toBe('left')
  })

  it('exports default order from column definitions in order', () => {
    expect(DEFAULT_ORDER).toEqual(COLUMN_DEFS.map((column) => column.id))
  })

  it('exports hidden columns from definitions marked invisible by default', () => {
    expect(DEFAULT_HIDDEN).toEqual(COLUMN_DEFS.filter((column) => !column.defaultVisible).map((column) => column.id))
  })

  it('exports widths for every column', () => {
    expect(Object.keys(DEFAULT_WIDTHS)).toEqual(COLUMN_DEFS.map((column) => column.id))
    for (const column of COLUMN_DEFS) {
      expect(DEFAULT_WIDTHS[column.id]).toBe(column.defaultWidth)
    }
  })

  it('defines required schema fields for every column', () => {
    for (const column of COLUMN_DEFS) {
      expect(column.id).toBeTruthy()
      expect(column.header).toBeTypeOf('string')
      expect(column.cellType).toBeTruthy()
      expect(column.defaultWidth).toBeGreaterThan(0)
      expect(column.minWidth).toBeGreaterThan(0)
    }
  })

  it('formats file size accessors with formatBytes', () => {
    const fileSizeColumn = COLUMN_DEFS.find((column) => column.id === 'fileSize')
    const book = {
      id: 1,
      status: 'present',
      title: 'Dune',
      authors: ['Frank Herbert'],
      seriesName: null,
      seriesIndex: null,
      files: [{ id: 10, format: 'epub', role: 'primary', sizeBytes: 2048 }],
      publishedDate: '1965-08-01',
      publishedYear: 1965,
      language: 'en',
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
      customMetadata: [],
    } satisfies BookCard

    const value = fileSizeColumn?.accessor?.(book)

    expect(formatBytes).toHaveBeenCalledWith(2048)
    expect(value).toBe('formatted:2048')
  })

  it('all column accessors can be called without throwing', () => {
    const book = makeBook({
      title: 'Dune',
      seriesName: 'Dune Series',
      seriesIndex: 1,
      publishedDate: '1965-08-01',
      publishedYear: 1965,
      language: 'en',
      rating: 4,
      metadataScore: 90,
      genres: ['Sci-Fi'],
      tags: ['classic'],
      subtitle: 'A Novel',
      publisher: 'Chilton Books',
      pageCount: 412,
      isbn13: '9780441013593',
      narrators: ['Scott Brick'],
      readingProgress: 60,
      readStatus: { status: 'reading', source: 'manual', startedAt: '2025-01-01T00:00:00Z', finishedAt: null, updatedAt: '2025-01-02T00:00:00Z' },
      updatedAt: '2025-06-01T00:00:00Z',
      addedAt: '2025-01-01T00:00:00Z',
      files: [{ id: 1, format: 'epub', role: 'primary', sizeBytes: 1024 }],
    })
    const columnsWithAccessors = COLUMN_DEFS.filter((c) => c.accessor)
    for (const column of columnsWithAccessors) {
      expect(() => column.accessor!(book)).not.toThrow()
    }
  })

  it('title accessor returns the book title', () => {
    const book = makeBook({ title: 'Dune' })
    const def = COLUMN_DEFS.find((c) => c.id === 'title')!
    expect(def.accessor!(book)).toBe('Dune')
  })

  it('seriesName accessor returns the series name', () => {
    const book = makeBook({ seriesName: 'Dune Cycle' })
    const def = COLUMN_DEFS.find((c) => c.id === 'seriesName')!
    expect(def.accessor!(book)).toBe('Dune Cycle')
  })

  it('seriesIndex accessor returns the series index', () => {
    const book = makeBook({ seriesIndex: 2 })
    const def = COLUMN_DEFS.find((c) => c.id === 'seriesIndex')!
    expect(def.accessor!(book)).toBe(2)
  })

  it('publishedDate column uses the published year lock and full date sort field', () => {
    const book = makeBook({ publishedDate: '1965-08-01', publishedYear: 1965 })
    const def = COLUMN_DEFS.find((c) => c.id === 'publishedDate')!

    expect(def.accessor!(book)).toBe('1965-08-01')
    expect(def.sortField).toBe('publishedDate')
    expect(def.lockField).toBe('publishedYear')
    expect(def.isEditable).not.toBe(true)
  })

  it('readingProgress accessor returns the progress value', () => {
    const book = makeBook({ readingProgress: 75 })
    const def = COLUMN_DEFS.find((c) => c.id === 'readingProgress')!
    expect(def.accessor!(book)).toBe(75)
  })

  it('finishedAt accessor returns finishedAt from readStatus', () => {
    const book = makeBook({
      readStatus: { status: 'read', source: 'manual', startedAt: null, finishedAt: '2025-06-01T00:00:00Z', updatedAt: '2025-06-01T00:00:00Z' },
    })
    const def = COLUMN_DEFS.find((c) => c.id === 'finishedAt')!
    expect(def.accessor!(book)).toBe('2025-06-01T00:00:00Z')
  })

  it('finishedAt accessor returns null when readStatus is null', () => {
    const book = makeBook({ readStatus: null })
    const def = COLUMN_DEFS.find((c) => c.id === 'finishedAt')!
    expect(def.accessor!(book)).toBeNull()
  })

  it('updatedAt accessor returns updatedAt from book', () => {
    const book = makeBook({ updatedAt: '2025-06-01T00:00:00Z' })
    const def = COLUMN_DEFS.find((c) => c.id === 'updatedAt')!
    expect(def.accessor!(book)).toBe('2025-06-01T00:00:00Z')
  })

  it('updatedAt accessor returns null when updatedAt is null', () => {
    const book = makeBook({ updatedAt: null })
    const def = COLUMN_DEFS.find((c) => c.id === 'updatedAt')!
    expect(def.accessor!(book)).toBeNull()
  })

  it('addedAt accessor returns addedAt from book', () => {
    const book = makeBook({ addedAt: '2024-12-01T00:00:00Z' })
    const def = COLUMN_DEFS.find((c) => c.id === 'addedAt')!
    expect(def.accessor!(book)).toBe('2024-12-01T00:00:00Z')
  })

  it('tags accessor returns empty array when tags is empty', () => {
    const book = makeBook({ tags: [] })
    const def = COLUMN_DEFS.find((c) => c.id === 'tags')!
    expect(def.accessor!(book)).toEqual([])
  })

  it('fileSize accessor returns null via formatBytes when book has no files', () => {
    const book = makeBook({ files: [] })
    const def = COLUMN_DEFS.find((c) => c.id === 'fileSize')!
    def.accessor!(book)
    expect(formatBytes).toHaveBeenCalledWith(null)
  })

  it('fileSize accessor uses the first file when no primary file exists', () => {
    const book = makeBook({ files: [{ id: 99, format: 'epub', role: 'content', sizeBytes: 512 }] })
    const def = COLUMN_DEFS.find((c) => c.id === 'fileSize')!
    def.accessor!(book)
    expect(formatBytes).toHaveBeenCalledWith(512)
  })
})

describe('isCustomColumnId', () => {
  it('returns true for a custom:N pattern', () => {
    expect(isCustomColumnId('custom:42')).toBe(true)
  })

  it('returns true for custom:0', () => {
    expect(isCustomColumnId('custom:0')).toBe(true)
  })

  it('returns false for a static column ID', () => {
    expect(isCustomColumnId('title')).toBe(false)
  })

  it('returns false for an empty string', () => {
    expect(isCustomColumnId('')).toBe(false)
  })

  it('returns false for a string starting with custom but not the right prefix', () => {
    expect(isCustomColumnId('customField')).toBe(false)
  })
})

describe('parseCustomFieldId', () => {
  it('returns the numeric field ID for a valid custom column ID', () => {
    expect(parseCustomFieldId('custom:42')).toBe(42)
  })

  it('returns 0 for custom:0', () => {
    expect(parseCustomFieldId('custom:0')).toBe(0)
  })

  it('returns null for a non-custom ID', () => {
    expect(parseCustomFieldId('title')).toBeNull()
  })

  it('returns null when the suffix is not a valid integer', () => {
    expect(parseCustomFieldId('custom:abc')).toBeNull()
  })

  it('returns null for custom: with no number', () => {
    expect(parseCustomFieldId('custom:')).toBeNull()
  })
})

describe('buildCustomColumnDef', () => {
  it('produces a column with id matching custom:fieldId', () => {
    const def = buildCustomColumnDef(makeField({ id: 7 }))
    expect(def.id).toBe('custom:7')
  })

  it('uses field label as column header', () => {
    const def = buildCustomColumnDef(makeField({ label: 'Award Winner' }))
    expect(def.header).toBe('Award Winner')
  })

  it('sets customFieldId and customFieldType on the def', () => {
    const def = buildCustomColumnDef(makeField({ id: 42, type: 'number' }))
    expect(def.customFieldId).toBe(42)
    expect(def.customFieldType).toBe('number')
  })

  it('maps text type to text cell type', () => {
    expect(buildCustomColumnDef(makeField({ type: 'text' })).cellType).toBe('text')
  })

  it('maps url type to text cell type', () => {
    expect(buildCustomColumnDef(makeField({ type: 'url' })).cellType).toBe('text')
  })

  it('maps number type to number cell type', () => {
    expect(buildCustomColumnDef(makeField({ type: 'number' })).cellType).toBe('number')
  })

  it('maps date type to date cell type', () => {
    expect(buildCustomColumnDef(makeField({ type: 'date' })).cellType).toBe('date')
  })

  it('maps boolean type to customBoolean cell type', () => {
    expect(buildCustomColumnDef(makeField({ type: 'boolean' })).cellType).toBe('customBoolean')
  })

  it('is not visible by default', () => {
    expect(buildCustomColumnDef(makeField()).defaultVisible).toBe(false)
  })

  it('is editable for text, url, number, and boolean types', () => {
    for (const type of ['text', 'url', 'number', 'boolean'] as const) {
      expect(buildCustomColumnDef(makeField({ type })).isEditable).toBe(true)
    }
  })

  it('is NOT editable for date type (BookTableDateCell is display-only)', () => {
    expect(buildCustomColumnDef(makeField({ type: 'date' })).isEditable).toBe(false)
  })

  it('has no pinned side', () => {
    expect(buildCustomColumnDef(makeField()).pinned).toBeNull()
  })

  it('has no lockField', () => {
    expect(buildCustomColumnDef(makeField()).lockField).toBeUndefined()
  })

  it('has no sortField', () => {
    expect(buildCustomColumnDef(makeField()).sortField).toBeNull()
  })

  it('accessor returns the value from book.customMetadata for the matching fieldId', () => {
    const def = buildCustomColumnDef(makeField({ id: 42 }))
    const book = makeBook({
      customMetadata: [{ fieldId: 42, key: 'my_field', label: 'My Field', type: 'text', displayOrder: 0, value: 'hello' }],
    })
    expect(def.accessor!(book)).toBe('hello')
  })

  it('accessor returns null when no matching entry exists in book.customMetadata', () => {
    const def = buildCustomColumnDef(makeField({ id: 99 }))
    const book = makeBook({
      customMetadata: [{ fieldId: 42, key: 'other', label: 'Other', type: 'text', displayOrder: 0, value: 'hello' }],
    })
    expect(def.accessor!(book)).toBeNull()
  })

  it('accessor returns null for empty customMetadata array', () => {
    const def = buildCustomColumnDef(makeField({ id: 42 }))
    const book = makeBook({ customMetadata: [] })
    expect(def.accessor!(book)).toBeNull()
  })

  it('accessor returns boolean value correctly', () => {
    const def = buildCustomColumnDef(makeField({ id: 5, type: 'boolean' }))
    const book = makeBook({
      customMetadata: [{ fieldId: 5, key: 'bool_field', label: 'Bool', type: 'boolean', displayOrder: 0, value: true }],
    })
    expect(def.accessor!(book)).toBe(true)
  })

  it('has a positive defaultWidth and minWidth', () => {
    const def = buildCustomColumnDef(makeField())
    expect(def.defaultWidth).toBeGreaterThan(0)
    expect(def.minWidth).toBeGreaterThan(0)
  })
})
