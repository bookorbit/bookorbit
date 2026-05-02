import type { BookCard } from '@bookorbit/types'
import { isAudioFormat } from '@bookorbit/types'
import { COLUMN_DEF_MAP, type ColumnId } from './tableColumnSchema'
import type { useTableLocks } from './useTableLocks'

export function useTableCellHelpers(locks: ReturnType<typeof useTableLocks>, isReadOnly: () => boolean) {
  function getCellValue(book: BookCard, colId: ColumnId): unknown {
    return COLUMN_DEF_MAP.get(colId)?.accessor?.(book) ?? null
  }

  function isCellLocked(book: BookCard, colId: ColumnId): boolean {
    const lockField = COLUMN_DEF_MAP.get(colId)?.lockField
    if (!lockField) return false
    return locks.isLocked(book.id, lockField)
  }

  function isBookAudio(book: BookCard): boolean {
    const primaryFile = book.files.find((f) => f.role === 'primary') ?? book.files[0] ?? null
    return primaryFile?.format ? isAudioFormat(primaryFile.format) : false
  }

  function isCellReadOnly(book: BookCard, col: { id: ColumnId; isEditable: boolean }): boolean {
    if (!col.isEditable) return true
    if (col.id === 'narrators' && !isBookAudio(book)) return true
    if (isCellLocked(book, col.id)) return true
    if (isReadOnly()) return true
    return false
  }

  function isMandatoryFieldEmpty(book: BookCard, colId: ColumnId): boolean {
    if (colId === 'title') return !book.title
    if (colId === 'authors') return book.authors.length === 0
    return false
  }

  function isBookFileMissing(book: BookCard): boolean {
    return book.status === 'missing'
  }

  function getPinnedCellBackground(book: BookCard, colId: ColumnId, isSelected: boolean): string {
    const isMandatory = isMandatoryFieldEmpty(book, colId)
    if (isSelected && isMandatory)
      return 'color-mix(in oklch, color-mix(in oklch, oklch(0.769 0.188 70.08) 5%, var(--background)) 92%, var(--primary))'
    if (isSelected) return 'color-mix(in oklch, var(--primary) 8%, var(--background))'
    if (isMandatory) return 'color-mix(in oklch, oklch(0.769 0.188 70.08) 5%, var(--background))'
    return 'var(--background)'
  }

  return { getCellValue, isCellLocked, isBookAudio, isCellReadOnly, isMandatoryFieldEmpty, isBookFileMissing, getPinnedCellBackground }
}
