import { ref, type Ref } from 'vue'
import type { BookCard } from '@bookorbit/types'
import type { ColumnDef, ColumnId } from './useTableColumns'
import { COLUMN_DEF_MAP } from './useTableColumns'

function formatCellForClipboard(book: BookCard, colId: ColumnId): string {
  const def = COLUMN_DEF_MAP.get(colId)
  if (!def?.accessor) return ''
  const value = def.accessor(book)
  if (value == null) return ''
  if (Array.isArray(value)) return (value as string[]).join(', ')
  if (typeof value === 'object' && 'status' in (value as Record<string, unknown>)) {
    return String((value as { status?: string }).status ?? '')
  }
  return String(value)
}

function formatRowForClipboard(book: BookCard, columns: ColumnDef[]): string {
  return columns
    .map((column) => `${column.header ?? column.id}: ${formatCellForClipboard(book, column.id)}`)
    .filter((line) => line.trim().length > 0)
    .join('\n')
}

async function copyToClipboard(text: string): Promise<void> {
  if (!text) return

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Fall through to legacy API below.
    }
  }

  if (typeof document === 'undefined') return
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '-9999px'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  try {
    document.execCommand('copy')
  } finally {
    document.body.removeChild(textarea)
  }
}

export function useTableKeyboard(opts: {
  books: () => BookCard[]
  displayColumns: Ref<ColumnDef[]>
  activeCellKey: Ref<string | null>
  selectionMode: () => boolean
  isReadOnly: () => boolean
  virtualizer: Ref<{ scrollToIndex: (index: number, opts?: Record<string, unknown>) => void }>
  isCellReadOnly: (book: BookCard, col: { id: ColumnId; isEditable: boolean }) => boolean
  onActivate: (book: BookCard, colId: ColumnId) => void
  onSelect: (id: number, event: MouseEvent) => void
  onCopyRow?: (book: BookCard) => void
}) {
  const focusedRowIndex = ref<number | null>(null)
  const focusedColIndex = ref<number | null>(null)

  function scrollToFocusedRow() {
    if (focusedRowIndex.value === null) return
    opts.virtualizer.value.scrollToIndex(focusedRowIndex.value, { align: 'auto' })
  }

  function isFocusedCell(rowIndex: number, colIndex: number): boolean {
    return focusedRowIndex.value === rowIndex && focusedColIndex.value === colIndex
  }

  function resolveFocusFromActiveCellKey(books: BookCard[], columns: ColumnDef[]): { rowIndex: number; colIndex: number } | null {
    const key = opts.activeCellKey.value
    if (!key) return null
    const separatorIndex = key.indexOf(':')
    if (separatorIndex <= 0) return null

    const rawBookId = key.slice(0, separatorIndex)
    const rawColId = key.slice(separatorIndex + 1)
    const bookId = Number(rawBookId)
    if (!Number.isFinite(bookId)) return null

    const rowIndex = books.findIndex((book) => book.id === bookId)
    if (rowIndex < 0) return null

    const colIndex = columns.findIndex((column) => column.id === rawColId)
    if (colIndex < 0) return null

    return { rowIndex, colIndex }
  }

  function resolveFocusFromEventTarget(event: KeyboardEvent, columns: ColumnDef[]): { rowIndex: number; colIndex: number } | null {
    const target = event.target
    if (!(target instanceof Element)) return null

    const cell = target.closest<HTMLElement>('[data-col-id][data-row-index]')
    if (!cell) return null

    const rowIndex = Number(cell.dataset.rowIndex)
    if (!Number.isFinite(rowIndex)) return null

    const colId = cell.dataset.colId
    if (!colId) return null

    const colIndex = columns.findIndex((column) => column.id === colId)
    if (colIndex < 0) return null

    return { rowIndex, colIndex }
  }

  function resolveCopyTarget(event: KeyboardEvent, books: BookCard[], columns: ColumnDef[]): { rowIndex: number; colIndex: number } | null {
    if (focusedRowIndex.value !== null && focusedColIndex.value !== null) {
      return { rowIndex: focusedRowIndex.value, colIndex: focusedColIndex.value }
    }

    const fromActiveCell = resolveFocusFromActiveCellKey(books, columns)
    if (fromActiveCell) return fromActiveCell

    return resolveFocusFromEventTarget(event, columns)
  }

  function handleTableKeydown(event: KeyboardEvent) {
    const key = event.key.toLowerCase()
    const isCopyShortcut = key === 'c' && (event.ctrlKey || event.metaKey)
    if (opts.activeCellKey.value && !isCopyShortcut) return

    const books = opts.books()
    if (books.length === 0) return
    const columns = opts.displayColumns.value
    const colCount = columns.length

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (focusedRowIndex.value === null) {
        focusedRowIndex.value = 0
        focusedColIndex.value = 0
      } else {
        focusedRowIndex.value = Math.min(focusedRowIndex.value + 1, books.length - 1)
      }
      scrollToFocusedRow()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (focusedRowIndex.value === null) {
        focusedRowIndex.value = 0
        focusedColIndex.value = 0
      } else {
        focusedRowIndex.value = Math.max(focusedRowIndex.value - 1, 0)
      }
      scrollToFocusedRow()
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      if (focusedColIndex.value === null) {
        focusedColIndex.value = 0
      } else {
        focusedColIndex.value = Math.min(focusedColIndex.value + 1, colCount - 1)
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      if (focusedColIndex.value === null) {
        focusedColIndex.value = 0
      } else {
        focusedColIndex.value = Math.max(focusedColIndex.value - 1, 0)
      }
    } else if (event.key === 'Home') {
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        focusedRowIndex.value = 0
        scrollToFocusedRow()
      }
      focusedColIndex.value = 0
    } else if (event.key === 'End') {
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        focusedRowIndex.value = books.length - 1
        scrollToFocusedRow()
      }
      focusedColIndex.value = colCount - 1
    } else if (event.key === ' ' && focusedRowIndex.value !== null && opts.selectionMode()) {
      event.preventDefault()
      if (focusedRowIndex.value >= books.length) return
      const book = books[focusedRowIndex.value]
      if (book) opts.onSelect(book.id, event as unknown as MouseEvent)
    } else if (isCopyShortcut) {
      event.preventDefault()
      const target = resolveCopyTarget(event, books, columns)
      if (!target) return
      if (target.rowIndex >= books.length || target.colIndex >= colCount) return

      focusedRowIndex.value = target.rowIndex
      focusedColIndex.value = target.colIndex

      const book = books[target.rowIndex]
      if (!book) return

      if (event.shiftKey) {
        const text = formatRowForClipboard(book, columns)
        void copyToClipboard(text)
        opts.onCopyRow?.(book)
        return
      }

      const col = columns[target.colIndex]
      if (col) {
        const text = formatCellForClipboard(book, col.id)
        void copyToClipboard(text)
      }
    }
  }

  return {
    focusedRowIndex,
    focusedColIndex,
    isFocusedCell,
    handleTableKeydown,
  }
}
