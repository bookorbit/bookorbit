import { AuditAction, type AuditLogEntry, type BookDeletionAuditBook, type BookDeletionAuditMeta } from '@bookorbit/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isDeletionBook(value: unknown): value is BookDeletionAuditBook {
  return (
    isRecord(value) &&
    Number.isInteger(value.id) &&
    typeof value.id === 'number' &&
    value.id > 0 &&
    (typeof value.title === 'string' || value.title === null)
  )
}

export function getBookDeletionAuditMeta(entry: AuditLogEntry): BookDeletionAuditMeta | null {
  if (entry.action !== AuditAction.BookBulkDelete || !isRecord(entry.meta)) return null

  const { total, books, omitted } = entry.meta
  if (
    typeof total !== 'number' ||
    !Number.isInteger(total) ||
    total < 0 ||
    !Array.isArray(books) ||
    !books.every(isDeletionBook) ||
    typeof omitted !== 'number' ||
    !Number.isInteger(omitted) ||
    omitted < 0 ||
    books.length + omitted !== total
  ) {
    return null
  }

  return { total, books, omitted }
}
