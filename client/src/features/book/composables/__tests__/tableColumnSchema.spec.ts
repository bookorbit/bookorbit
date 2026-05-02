import { describe, expect, it, vi } from 'vitest'
import type { BookCard } from '@bookorbit/types'

vi.mock('@/lib/formatting', () => ({
  formatBytes: vi.fn<(bytes: number | null) => string>((bytes) => `formatted:${bytes}`),
}))

import { formatBytes } from '@/lib/formatting'
import { COLUMN_DEFS, COLUMN_DEF_MAP, DEFAULT_HIDDEN, DEFAULT_ORDER, DEFAULT_WIDTHS, LOCK_ROW_COLUMN_DEF } from '../tableColumnSchema'

describe('tableColumnSchema', () => {
  it('exposes 24 total column definitions including the lock row', () => {
    expect([LOCK_ROW_COLUMN_DEF, ...COLUMN_DEFS]).toHaveLength(24)
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
    } satisfies BookCard

    const value = fileSizeColumn?.accessor?.(book)

    expect(formatBytes).toHaveBeenCalledWith(2048)
    expect(value).toBe('formatted:2048')
  })
})
