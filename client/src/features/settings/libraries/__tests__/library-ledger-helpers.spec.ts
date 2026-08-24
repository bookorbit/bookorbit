// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Library, LibraryOverviewEntry } from '@bookorbit/types'

import { formatFamily, toFormatSegments } from '../lib/library-formats'
import { shortenPath } from '../lib/library-paths'
import { isLibrarySortField, matchesLibraryQuery, sortLibraries } from '../lib/library-sort'

function library(overrides: Partial<Library> & Pick<Library, 'id' | 'name'>): Library {
  return {
    icon: null,
    displayOrder: 0,
    coverAspectRatio: '2/3',
    watch: false,
    autoScanCronExpression: null,
    metadataPrecedence: [],
    formatPriority: [],
    allowedFormats: [],
    organizationMode: 'book_per_folder',
    excludePatterns: [],
    readingThreshold: 10,
    markAsFinishedPercentComplete: 90,
    fileNamingPattern: null,
    fileWriteEnabled: false,
    fileWriteWriteCover: false,
    fileWriteEpubEnabled: false,
    fileWriteEpubMaxFileSizeMb: 100,
    fileWriteFb2Enabled: false,
    fileWriteFb2MaxFileSizeMb: 100,
    fileWritePdfEnabled: false,
    fileWritePdfMaxFileSizeMb: 100,
    fileWriteCbxEnabled: false,
    fileWriteCbxMaxFileSizeMb: 500,
    fileWriteKindleEnabled: false,
    fileWriteKindleMaxFileSizeMb: 100,
    fileWriteAudioEnabled: false,
    fileWriteAudioMaxFileSizeMb: 500,
    fileRenameEnabled: false,
    folders: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function entry(overrides: Partial<LibraryOverviewEntry> & Pick<LibraryOverviewEntry, 'libraryId'>): LibraryOverviewEntry {
  return { totalBooks: 0, totalSizeBytes: 0, formatCounts: {}, lastScan: null, ...overrides }
}

describe('formatFamily', () => {
  it('groups related extensions under one family', () => {
    expect(formatFamily('epub')).toBe('ebook')
    expect(formatFamily('kepub')).toBe('ebook')
    expect(formatFamily('azw3')).toBe('kindle')
    expect(formatFamily('cbz')).toBe('comic')
    expect(formatFamily('m4b')).toBe('audio')
    expect(formatFamily('pdf')).toBe('document')
  })

  it('is case insensitive and falls back for unknown extensions', () => {
    expect(formatFamily('EPUB')).toBe('ebook')
    expect(formatFamily('djvu')).toBe('other')
  })
})

describe('toFormatSegments', () => {
  it('orders by count and breaks ties alphabetically so the bar never jitters', () => {
    const segments = toFormatSegments({ mobi: 23, epub: 305, cbz: 8, azw3: 8 })
    expect(segments.map((segment) => segment.format)).toEqual(['epub', 'mobi', 'azw3', 'cbz'])
  })

  it('produces percentages that fill the bar', () => {
    const segments = toFormatSegments({ epub: 3, pdf: 1 })
    expect(segments.map((segment) => segment.percent)).toEqual([75, 25])
  })

  it('drops zero counts and returns nothing for an empty library', () => {
    expect(toFormatSegments({ epub: 0 })).toEqual([])
    expect(toFormatSegments({})).toEqual([])
  })
})

describe('shortenPath', () => {
  it('keeps the tail segments that identify the library', () => {
    expect(shortenPath('/srv/media/books/novels')).toBe('…/books/novels')
  })

  it('leaves short paths untouched', () => {
    expect(shortenPath('/data/novels')).toBe('/data/novels')
  })

  it('ignores a trailing separator', () => {
    expect(shortenPath('/srv/media/books/novels/')).toBe('…/books/novels')
  })

  it('keeps Windows separators', () => {
    expect(shortenPath('D:\\media\\books\\novels')).toBe('…\\books\\novels')
  })
})

describe('matchesLibraryQuery', () => {
  const novels = library({
    id: 1,
    name: 'Novels',
    folders: [{ id: 1, path: '/srv/media/novels', createdAt: '2024-01-01T00:00:00.000Z' }],
  })

  it('matches on name, case insensitively', () => {
    expect(matchesLibraryQuery(novels, 'nov')).toBe(true)
    expect(matchesLibraryQuery(novels, 'NOVELS')).toBe(true)
  })

  it('matches on a folder path so a pasted path finds its library', () => {
    expect(matchesLibraryQuery(novels, '/srv/media')).toBe(true)
  })

  it('matches everything when the query is blank', () => {
    expect(matchesLibraryQuery(novels, '   ')).toBe(true)
  })

  it('rejects a query that matches neither', () => {
    expect(matchesLibraryQuery(novels, 'comics')).toBe(false)
  })
})

describe('sortLibraries', () => {
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
  const libraries = [library({ id: 1, name: 'Novels' }), library({ id: 2, name: 'Audiobooks' }), library({ id: 3, name: 'comics' })]
  const overview = new Map<number, LibraryOverviewEntry>([
    [1, entry({ libraryId: 1, totalBooks: 381, totalSizeBytes: 727, lastScan: null })],
    [
      2,
      entry({
        libraryId: 2,
        totalBooks: 26,
        totalSizeBytes: 4751,
        lastScan: {
          status: 'completed',
          triggeredBy: 'manual',
          startedAt: '2024-05-01T00:00:00.000Z',
          completedAt: '2024-05-01T00:01:00.000Z',
          addedCount: 3,
          updatedCount: 0,
          missingCount: 0,
          errorMessage: null,
        },
      }),
    ],
    [3, entry({ libraryId: 3, totalBooks: 23, totalSizeBytes: 1554 })],
  ])

  it('leaves the caller-supplied display order alone by default', () => {
    expect(sortLibraries(libraries, 'default', overview, collator)).toBe(libraries)
  })

  it('sorts by name without being case sensitive', () => {
    expect(sortLibraries(libraries, 'name', overview, collator).map((l) => l.name)).toEqual(['Audiobooks', 'comics', 'Novels'])
  })

  it('sorts by book count, largest first', () => {
    expect(sortLibraries(libraries, 'books', overview, collator).map((l) => l.id)).toEqual([1, 2, 3])
  })

  it('sorts by size on disk, largest first', () => {
    expect(sortLibraries(libraries, 'size', overview, collator).map((l) => l.id)).toEqual([2, 3, 1])
  })

  it('sorts never-scanned libraries last', () => {
    expect(sortLibraries(libraries, 'lastScan', overview, collator).map((l) => l.id)[0]).toBe(2)
  })

  it('does not mutate the input array', () => {
    const input = [...libraries]
    sortLibraries(input, 'name', overview, collator)
    expect(input.map((l) => l.id)).toEqual([1, 2, 3])
  })
})

describe('isLibrarySortField', () => {
  it('accepts known fields and rejects anything else', () => {
    expect(isLibrarySortField('lastScan')).toBe(true)
    expect(isLibrarySortField('nonsense')).toBe(false)
  })
})
