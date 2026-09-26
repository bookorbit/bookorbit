import { describe, expect, it } from 'vitest'
import type { BookDuplicateCandidate, BookDuplicateGroup } from '@bookorbit/types'

import { copyFolderLabel, isProtectedCopy, protectedDiscards, reclaimableBytes, recommendKeeper } from '../duplicate-keeper'

function candidate(overrides: Partial<BookDuplicateCandidate> & { id: number }): BookDuplicateCandidate {
  return {
    title: 'Frankenstein',
    subtitle: null,
    authors: ['Mary Wollstonecraft Shelley'],
    libraryId: 1,
    libraryName: 'Novels',
    folderPath: 'Mary Wollstonecraft Shelley/Frankenstein (2018)/Frankenstein (2018).epub',
    status: 'present',
    files: [
      { id: overrides.id, format: 'epub', sizeBytes: 320_612, path: 'Mary Wollstonecraft Shelley/Frankenstein (2018)/Frankenstein (2018).epub' },
    ],
    isbn10: null,
    isbn13: null,
    metadataScore: 80,
    readStatus: null,
    readingProgress: null,
    collections: [],
    addedAt: '2026-08-24T07:55:31.000Z',
    updatedAt: null,
    hasCover: true,
    ...overrides,
  }
}

function group(books: BookDuplicateCandidate[]): BookDuplicateGroup {
  return { id: 1, reasons: ['exact_metadata'], maxTitleSimilarity: 1, reclaimableBytes: 0, books, pairs: [] }
}

describe('recommendKeeper', () => {
  it('keeps the best metadata and says what decided it', () => {
    const best = candidate({ id: 1, metadataScore: 88, isbn13: '9781466804807' })
    const worse = candidate({ id: 2, metadataScore: 79 })

    const result = recommendKeeper(group([worse, best]), 'metadata')

    expect(result.keeperId).toBe(1)
    expect(result.reasons).toContainEqual({ code: 'metadata', score: 88 })
    expect(result.reasons).toContainEqual({ code: 'isbn' })
  })

  it('never recommends discarding the only copy carrying reading progress, whatever the rule', () => {
    const readCopy = candidate({
      id: 1,
      metadataScore: 60,
      readingProgress: 0.19,
      files: [{ id: 1, format: 'epub', sizeBytes: 1_000, path: 'a.epub' }],
    })
    const bigger = candidate({ id: 2, metadataScore: 95, files: [{ id: 2, format: 'epub', sizeBytes: 900_000, path: 'b.epub' }] })

    for (const rule of ['metadata', 'size', 'formats', 'oldest', 'newest'] as const) {
      expect(recommendKeeper(group([bigger, readCopy]), rule).keeperId).toBe(1)
    }
    expect(recommendKeeper(group([bigger, readCopy]), 'metadata').reasons[0]).toEqual({ code: 'reading', percent: 0.19 })
  })

  it('falls back to the rule when two copies both carry reading state, so the row can warn', () => {
    const readA = candidate({ id: 1, metadataScore: 70, readingProgress: 0.2 })
    const readB = candidate({ id: 2, metadataScore: 90, readingProgress: 0.4 })

    const result = recommendKeeper(group([readA, readB]), 'metadata')

    expect(result.keeperId).toBe(2)
    expect(protectedDiscards(group([readA, readB]), result.keeperId)).toHaveLength(1)
  })

  it('follows the size rule when no copy is protected', () => {
    const small = candidate({ id: 1, metadataScore: 95, files: [{ id: 1, format: 'epub', sizeBytes: 1_000, path: 'a.epub' }] })
    const large = candidate({ id: 2, metadataScore: 60, files: [{ id: 2, format: 'epub', sizeBytes: 900_000, path: 'b.epub' }] })

    expect(recommendKeeper(group([small, large]), 'size').keeperId).toBe(2)
    expect(recommendKeeper(group([small, large]), 'metadata').keeperId).toBe(1)
  })
})

describe('reclaimableBytes', () => {
  it('counts every copy but the keeper, across multi-file books', () => {
    const keeper = candidate({ id: 1, files: [{ id: 1, format: 'mp3', sizeBytes: 500, path: 'a/1.mp3' }] })
    const discard = candidate({
      id: 2,
      files: [
        { id: 2, format: 'mp3', sizeBytes: 300, path: 'b/1.mp3' },
        { id: 3, format: 'mp3', sizeBytes: 200, path: 'b/2.mp3' },
      ],
    })

    expect(reclaimableBytes(group([keeper, discard]), 1)).toBe(500)
    expect(reclaimableBytes(group([keeper, discard]), 2)).toBe(500)
  })
})

describe('copy labels', () => {
  it('names a copy by the folder that tells it apart, not the shared title', () => {
    expect(copyFolderLabel(candidate({ id: 1 }))).toBe('Frankenstein (2018)')
  })

  it('falls back to the file name for a loose file', () => {
    const loose = candidate({ id: 1, files: [{ id: 1, format: 'epub', sizeBytes: 1, path: 'Resident Evil 04 - Underworld - S.D. Perry.epub' }] })
    expect(copyFolderLabel(loose)).toBe('Resident Evil 04 - Underworld - S.D. Perry.epub')
  })

  it('treats collection membership as protection even without reading progress', () => {
    expect(isProtectedCopy(candidate({ id: 1, collections: [{ id: 3, name: 'Book club' }] }))).toBe(true)
    expect(isProtectedCopy(candidate({ id: 2 }))).toBe(false)
  })
})
