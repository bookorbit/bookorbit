import type { BookFileWriteField, BookFileWriteStatus, BookFileWriteTargetSkipReason, BookFileWriteTargetStatus } from '@bookorbit/types'

/**
 * The server's verdict for one file. Which files a book writes to is decided by one selector on the
 * server; the client reads its answer rather than re-deriving the rule, which used to drift.
 */
export function findFileWriteTarget(status: BookFileWriteStatus | null | undefined, fileId: number): BookFileWriteTargetStatus | null {
  return status?.targets?.find((target) => target.fileId === fileId) ?? null
}

export type WritableFormatFields = { format: string; fields: BookFileWriteField[] }

/**
 * The fields each writable format holds, in write order. A mixed book writes different fields into
 * its EPUB and its M4B, which a single union of fields cannot say.
 */
export function writableFieldsByFormat(status: BookFileWriteStatus | null | undefined): WritableFormatFields[] {
  const byFormat = new Map<string, Set<BookFileWriteField>>()
  for (const target of status?.targets ?? []) {
    if (!target.writable || !target.format) continue
    const fields = byFormat.get(target.format) ?? new Set<BookFileWriteField>()
    for (const field of target.writableFields) fields.add(field)
    byFormat.set(target.format, fields)
  }
  return [...byFormat].map(([format, fields]) => ({ format, fields: [...fields] }))
}

export const FILE_WRITE_SKIP_MESSAGE_KEYS: Record<BookFileWriteTargetSkipReason, string> = {
  format_not_supported: 'book.detail.files.notWritten.formatNotSupported',
  format_disabled: 'book.detail.files.notWritten.formatDisabled',
  file_exceeds_size_limit: 'book.detail.files.notWritten.fileExceedsSizeLimit',
  not_content_file: 'book.detail.files.notWritten.notContentFile',
}
