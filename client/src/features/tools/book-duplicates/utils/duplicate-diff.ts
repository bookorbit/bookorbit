import type { BookDuplicateCandidate, BookDuplicateGroup, BookDuplicateMatchReason } from '@bookorbit/types'

import { copyBytes, copyFormats } from './duplicate-keeper'

export const DUPLICATE_FIELDS = ['size', 'formats', 'isbn', 'metadata', 'library', 'reading', 'collections', 'added'] as const
export type DuplicateField = (typeof DUPLICATE_FIELDS)[number]

/**
 * Copies of one book agree about most things, so the comparison only earns its space when it drops
 * the fields that are the same everywhere. `same` decides whether a field becomes a row or joins
 * the one-line summary above it.
 */
export function duplicateFieldIsShared(books: BookDuplicateCandidate[], field: DuplicateField): boolean {
  const values = books.map((book) => fieldSignature(book, field))
  return new Set(values).size <= 1
}

function fieldSignature(book: BookDuplicateCandidate, field: DuplicateField): string {
  switch (field) {
    case 'size':
      return String(copyBytes(book))
    case 'formats':
      return copyFormats(book).sort().join(',')
    case 'isbn':
      return book.isbn13 ?? book.isbn10 ?? ''
    case 'metadata':
      return String(book.metadataScore ?? '')
    case 'library':
      return book.libraryName
    case 'reading':
      return book.readingProgress === null ? '' : String(Math.round(book.readingProgress * 100))
    case 'collections':
      return book.collections
        .map((collection) => collection.name)
        .sort()
        .join(',')
    case 'added':
      return book.addedAt.slice(0, 10)
  }
}

export function sharedFields(books: BookDuplicateCandidate[]): DuplicateField[] {
  return DUPLICATE_FIELDS.filter((field) => duplicateFieldIsShared(books, field))
}

export function differingFields(books: BookDuplicateCandidate[]): DuplicateField[] {
  return DUPLICATE_FIELDS.filter((field) => !duplicateFieldIsShared(books, field))
}

/** The copy with the most bytes, when the copies differ; used to mark the winning cell. */
export function largestCopyId(books: BookDuplicateCandidate[]): number | null {
  const sizes = books.map(copyBytes)
  if (new Set(sizes).size <= 1) return null
  const best = Math.max(...sizes)
  return books.find((book) => copyBytes(book) === best)?.id ?? null
}

export function bestMetadataId(books: BookDuplicateCandidate[]): number | null {
  const scores = books.map((book) => book.metadataScore ?? -1)
  if (new Set(scores).size <= 1) return null
  const best = Math.max(...scores)
  return books.find((book) => (book.metadataScore ?? -1) === best)?.id ?? null
}

export type PathSegment = { text: string; changed: boolean }

/**
 * Splits a path so the segment that tells this copy from the others can be marked, the way
 * bulk rename marks an edit. Compares from both ends because copies often sit at different
 * depths, and an index-by-index comparison would then mark every segment.
 */
export function diffPathSegments(path: string, others: string[]): PathSegment[] {
  const segments = path.split('/').filter(Boolean)
  const rest = others.filter((other) => other !== path).map((other) => other.split('/').filter(Boolean))
  if (rest.length === 0) return segments.map((text) => ({ text, changed: false }))

  let prefix = 0
  while (prefix < segments.length && rest.every((other) => other[prefix] === segments[prefix])) prefix++
  let suffix = 0
  while (suffix < segments.length - prefix && rest.every((other) => other[other.length - 1 - suffix] === segments[segments.length - 1 - suffix])) {
    suffix++
  }

  return segments.map((text, index) => ({ text, changed: index >= prefix && index < segments.length - suffix }))
}

const REASON_RANK: Record<BookDuplicateMatchReason, number> = {
  file_hash: 4,
  isbn: 3,
  exact_metadata: 2,
  fuzzy_metadata: 1,
}

/** Reasons strongest first, so a group leads with the one that decides how much judgement it needs. */
export function rankedReasons(reasons: BookDuplicateMatchReason[]): BookDuplicateMatchReason[] {
  return [...reasons].sort((a, b) => REASON_RANK[b] - REASON_RANK[a])
}

export function strongestReason(group: BookDuplicateGroup): BookDuplicateMatchReason {
  return rankedReasons(group.reasons)[0] ?? 'fuzzy_metadata'
}
