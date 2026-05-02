import type { BookCard, BookMetadataLockField } from '@bookorbit/types'

export function resolveLatestBook(books: readonly BookCard[], fallbackBook: BookCard): BookCard {
  return books.find((entry) => entry.id === fallbackBook.id) ?? fallbackBook
}

export function mergeBookPatchWithLatest(books: readonly BookCard[], fallbackBook: BookCard, patch: Partial<BookCard>): BookCard {
  const latest = resolveLatestBook(books, fallbackBook)
  return { ...latest, ...patch }
}

export function sameLockFields(a: readonly BookMetadataLockField[], b: readonly BookMetadataLockField[]): boolean {
  if (a.length !== b.length) return false
  const bSet = new Set(b)
  return a.every((field) => bSet.has(field))
}

export function buildLockStateBookUpdate(
  books: readonly BookCard[],
  fallbackBook: BookCard,
  nextFields: readonly BookMetadataLockField[],
): BookCard | null {
  const latest = resolveLatestBook(books, fallbackBook)
  const normalizedFields = [...nextFields]
  const hasMetadataLocks = normalizedFields.length > 0
  if (sameLockFields(latest.lockedFields, normalizedFields) && latest.hasMetadataLocks === hasMetadataLocks) return null
  return {
    ...latest,
    lockedFields: normalizedFields,
    hasMetadataLocks,
  }
}
