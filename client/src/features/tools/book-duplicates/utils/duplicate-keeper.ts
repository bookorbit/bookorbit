import type { BookDuplicateCandidate, BookDuplicateGroup } from '@bookorbit/types'

export const DUPLICATE_KEEP_RULES = ['metadata', 'size', 'formats', 'oldest', 'newest'] as const
export type DuplicateKeepRule = (typeof DUPLICATE_KEEP_RULES)[number]

/**
 * Why a copy was picked, as data rather than a sentence: the ledger renders these through i18n and
 * a rule is only trustworthy when it can say what decided it.
 */
export type KeeperReason =
  | { code: 'reading'; percent: number }
  | { code: 'collection'; name: string }
  | { code: 'metadata'; score: number }
  | { code: 'largest'; bytes: number }
  | { code: 'formats'; count: number }
  | { code: 'isbn' }
  | { code: 'added'; at: string }

export function copyBytes(book: BookDuplicateCandidate): number {
  return book.files.reduce((total, file) => total + (file.sizeBytes ?? 0), 0)
}

export function copyFormats(book: BookDuplicateCandidate): string[] {
  return [...new Set(book.files.map((file) => file.format?.toLowerCase()).filter((format): format is string => !!format))]
}

/**
 * The folder that tells two copies apart. Copies of one book share a title, so the row label has to
 * come from the path: the parent folder, or the file name when the book is a loose file.
 */
export function copyFolderLabel(book: BookDuplicateCandidate): string {
  const path = book.files[0]?.path ?? book.folderPath
  if (!path) return ''
  const segments = path.split('/').filter(Boolean)
  return segments.at(-2) ?? segments.at(-1) ?? ''
}

/** A copy carrying reading state or collection membership is never discarded without saying so. */
export function isProtectedCopy(book: BookDuplicateCandidate): boolean {
  return (book.readingProgress !== null && book.readingProgress > 0) || book.collections.length > 0
}

function ruleVector(book: BookDuplicateCandidate, rule: DuplicateKeepRule): number[] {
  const added = new Date(book.addedAt).getTime()
  switch (rule) {
    case 'size':
      return [copyBytes(book), book.metadataScore ?? 0, -added]
    case 'formats':
      return [copyFormats(book).length, book.metadataScore ?? 0, copyBytes(book)]
    case 'oldest':
      return [-added, book.metadataScore ?? 0]
    case 'newest':
      return [added, book.metadataScore ?? 0]
    default:
      return [book.metadataScore ?? 0, book.files.length, copyBytes(book), -added]
  }
}

function compareVectors(a: number[], b: number[]): number {
  for (let index = 0; index < a.length; index++) {
    const left = a[index] ?? 0
    const right = b[index] ?? 0
    if (left !== right) return right - left
  }
  return 0
}

export function recommendKeeper(group: BookDuplicateGroup, rule: DuplicateKeepRule): { keeperId: number; reasons: KeeperReason[] } {
  const books = group.books
  const fallback = { keeperId: books[0]?.id ?? 0, reasons: [] as KeeperReason[] }
  if (books.length === 0) return fallback

  // A single copy carrying reading state wins outright: freeing bytes never justifies deleting the
  // copy someone is part way through. Two such copies fall back to the rule, which cannot pick
  // between them safely, so the warning stays on the row.
  const protectedCopies = books.filter(isProtectedCopy)
  const pool = protectedCopies.length === 1 ? protectedCopies : books
  const keeper = [...pool].sort((a, b) => compareVectors(ruleVector(a, rule), ruleVector(b, rule)))[0]
  if (!keeper) return fallback

  const reasons: KeeperReason[] = []
  if (protectedCopies.length === 1 && protectedCopies[0]?.id === keeper.id) {
    if (keeper.readingProgress !== null && keeper.readingProgress > 0) {
      reasons.push({ code: 'reading', percent: keeper.readingProgress })
    } else if (keeper.collections[0]) {
      reasons.push({ code: 'collection', name: keeper.collections[0].name })
    }
  }
  if (keeper.metadataScore !== null) reasons.push({ code: 'metadata', score: keeper.metadataScore })

  const keeperBytes = copyBytes(keeper)
  const largest = Math.max(...books.map(copyBytes))
  if (keeperBytes === largest && books.some((book) => copyBytes(book) < largest)) {
    reasons.push({ code: 'largest', bytes: keeperBytes })
  }
  const formatCount = copyFormats(keeper).length
  if (formatCount > 1 && books.some((book) => copyFormats(book).length < formatCount)) {
    reasons.push({ code: 'formats', count: formatCount })
  }
  if ((keeper.isbn13 ?? keeper.isbn10) && books.some((book) => !book.isbn13 && !book.isbn10)) {
    reasons.push({ code: 'isbn' })
  }
  if (reasons.length === 0) reasons.push({ code: 'added', at: keeper.addedAt })

  return { keeperId: keeper.id, reasons }
}

/** Bytes freed by deleting every copy but the keeper. */
export function reclaimableBytes(group: BookDuplicateGroup, keeperId: number): number {
  return group.books.filter((book) => book.id !== keeperId).reduce((total, book) => total + copyBytes(book), 0)
}

/** Copies that would be deleted even though they carry reading state or collection membership. */
export function protectedDiscards(group: BookDuplicateGroup, keeperId: number): BookDuplicateCandidate[] {
  return group.books.filter((book) => book.id !== keeperId && isProtectedCopy(book))
}
