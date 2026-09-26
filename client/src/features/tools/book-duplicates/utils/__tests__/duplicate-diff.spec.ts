import { describe, expect, it } from 'vitest'
import type { BookDuplicateCandidate } from '@bookorbit/types'

import { diffPathSegments, differingFields, sharedFields, strongestReason } from '../duplicate-diff'

function candidate(overrides: Partial<BookDuplicateCandidate> & { id: number }): BookDuplicateCandidate {
  return {
    title: 'Ghost Story',
    subtitle: null,
    authors: ['Peter Straub'],
    libraryId: 1,
    libraryName: 'Novels',
    folderPath: 'Peter Straub/Ghost Story (2013)/Ghost Story (2013).epub',
    status: 'present',
    files: [{ id: overrides.id, format: 'epub', sizeBytes: 1_548_214, path: 'Peter Straub/Ghost Story (2013)/Ghost Story (2013).epub' }],
    isbn10: null,
    isbn13: '9788845275289',
    metadataScore: 88,
    readStatus: null,
    readingProgress: null,
    collections: [],
    addedAt: '2026-08-22T03:15:32.000Z',
    updatedAt: null,
    hasCover: true,
    ...overrides,
  }
}

describe('field partitioning', () => {
  it('separates what differs from what every copy agrees on', () => {
    const a = candidate({ id: 1 })
    const b = candidate({
      id: 2,
      isbn13: '0671685635',
      metadataScore: 82,
      files: [{ id: 2, format: 'epub', sizeBytes: 912_233, path: 'Peter Straub/Ghost Story (1989)/Ghost Story (1989).epub' }],
    })

    expect(differingFields([a, b])).toEqual(['size', 'isbn', 'metadata'])
    expect(sharedFields([a, b])).toEqual(['formats', 'library', 'reading', 'collections', 'added'])
  })
})

describe('diffPathSegments', () => {
  it('marks only the segment that tells two copies apart', () => {
    const a = 'Peter Straub/Ghost Story (2013)/Ghost Story (2013).epub'
    const b = 'Peter Straub/Ghost Story (1989)/Ghost Story (1989).epub'

    expect(diffPathSegments(a, [a, b]).map((segment) => [segment.text, segment.changed])).toEqual([
      ['Peter Straub', false],
      ['Ghost Story (2013)', true],
      ['Ghost Story (2013).epub', true],
    ])
  })

  it('aligns from both ends so copies at different depths do not mark every segment', () => {
    const deep = "Cixin Liu/The Remembrance of Earth's Past/01. The Three-Body Problem (2014)/Part01.mp3"
    const flat = 'Cixin Liu/01. The Three-Body Problem (2014)/Part01.mp3'

    expect(
      diffPathSegments(deep, [deep, flat])
        .filter((segment) => segment.changed)
        .map((segment) => segment.text),
    ).toEqual(["The Remembrance of Earth's Past"])
    expect(diffPathSegments(flat, [deep, flat]).filter((segment) => segment.changed)).toEqual([])
  })

  it('marks nothing when a copy stands alone', () => {
    const only = 'Alice Feeney/Beautiful Ugly (2024)/Beautiful Ugly (2024).epub'
    expect(diffPathSegments(only, [only]).every((segment) => !segment.changed)).toBe(true)
  })
})

describe('strongestReason', () => {
  it('leads with the reason that needs the least judgement', () => {
    expect(
      strongestReason({ id: 1, reasons: ['fuzzy_metadata', 'file_hash'], maxTitleSimilarity: 1, reclaimableBytes: 0, books: [], pairs: [] }),
    ).toBe('file_hash')
    expect(
      strongestReason({ id: 2, reasons: ['fuzzy_metadata', 'exact_metadata'], maxTitleSimilarity: 1, reclaimableBytes: 0, books: [], pairs: [] }),
    ).toBe('exact_metadata')
  })
})
