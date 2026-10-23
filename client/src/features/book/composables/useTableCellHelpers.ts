import type { BookCard } from '@bookorbit/types'
import { isAudioFormat } from '@bookorbit/types'
import { COLUMN_DEF_MAP, isCustomColumnId, parseCustomFieldId, type ColumnDef } from './tableColumnSchema'
import type { useTableLocks } from './useTableLocks'

const PERSONAL_STATE_COLUMN_IDS = new Set(['readStatus'])

export function useTableCellHelpers(
  locks: ReturnType<typeof useTableLocks>,
  isReadOnly: () => boolean,
  columnMapGetter?: () => Map<string, ColumnDef>,
  canEditBookMetadata?: (book: BookCard) => boolean,
) {
  function getCellValue(book: BookCard, colId: string): unknown {
    const map = columnMapGetter ? columnMapGetter() : (COLUMN_DEF_MAP as Map<string, ColumnDef>)
    return map.get(colId)?.accessor?.(book) ?? null
  }

  function isCellLocked(book: BookCard, colId: string): boolean {
    const lockField = (COLUMN_DEF_MAP as Map<string, ColumnDef>).get(colId)?.lockField
    if (!lockField) return false
    return locks.isLocked(book.id, lockField)
  }

  function isBookAudio(book: BookCard): boolean {
    const primaryFile = book.files.find((f) => f.role === 'primary') ?? book.files[0] ?? null
    return primaryFile?.format ? isAudioFormat(primaryFile.format) : false
  }

  function isCellReadOnly(book: BookCard, col: { id: string; isEditable: boolean }): boolean {
    if (!col.isEditable) return true
    if (canEditBookMetadata && !PERSONAL_STATE_COLUMN_IDS.has(col.id) && !canEditBookMetadata(book)) return true
    if (col.id === 'narrators' && !isBookAudio(book)) return true
    if (isCellLocked(book, col.id)) return true
    // Custom fields: block editing when the book has no entry for this field.
    // An entry (even value=null) means the field is enabled for the book's library.
    // No entry means the field is not enabled - editing would be rejected by the backend.
    if (isCustomColumnId(col.id)) {
      const fieldId = parseCustomFieldId(col.id)
      if (fieldId === null || !book.customMetadata.some((f) => f.fieldId === fieldId)) return true
    }
    if (isReadOnly()) return true
    return false
  }

  function isMandatoryFieldEmpty(book: BookCard, colId: string): boolean {
    if (colId === 'title') return !book.title
    if (colId === 'authors') return book.authors.length === 0
    return false
  }

  function isBookFileMissing(book: BookCard): boolean {
    return book.status === 'missing'
  }

  function getPinnedCellBackground(book: BookCard, colId: string, isSelected: boolean): string {
    const isMandatory = isMandatoryFieldEmpty(book, colId)
    if (isSelected && isMandatory)
      return 'color-mix(in oklch, color-mix(in oklch, oklch(0.769 0.188 70.08) 5%, var(--background)) 92%, var(--primary))'
    if (isSelected) return 'color-mix(in oklch, var(--primary) 8%, var(--background))'
    if (isMandatory) return 'color-mix(in oklch, oklch(0.769 0.188 70.08) 5%, var(--background))'
    return 'var(--background)'
  }

  return { getCellValue, isCellLocked, isBookAudio, isCellReadOnly, isMandatoryFieldEmpty, isBookFileMissing, getPinnedCellBackground }
}
