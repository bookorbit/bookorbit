import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import type { BookCard, CustomMetadataBookValue, ReadStatus } from '@bookorbit/types'
import type { ColumnId } from './tableColumnSchema'
import { COLUMN_DEF_MAP, isCustomColumnId, parseCustomFieldId } from './tableColumnSchema'

const METADATA_FIELD_MAP: Partial<Record<ColumnId, string>> = {
  title: 'title',
  authors: 'authors',
  seriesName: 'seriesName',
  seriesIndex: 'seriesIndex',
  publishedYear: 'publishedYear',
  language: 'language',
  rating: 'rating',
  genres: 'genres',
  tags: 'tags',
  subtitle: 'subtitle',
  publisher: 'publisher',
  pageCount: 'pageCount',
}

type SaveCallback = (updatedBook: Partial<BookCard>) => void

async function getApiErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown }
    if (typeof body.message === 'string' && body.message.trim().length > 0) return body.message
    if (Array.isArray(body.message) && body.message.length > 0) return body.message.join(', ')
  } catch {
    // Fall back to status text below.
  }
  return `HTTP ${response.status}`
}

function getToastErrorMessage(err: unknown): string {
  if (!(err instanceof Error) || !err.message) return 'Failed to save - change reverted'
  if (err.message.startsWith('Metadata fields are locked:')) return err.message
  if (err.message.includes('is not enabled for this book'))
    return 'This field is not available for this book - enable it for the library in Settings first'
  if (/^HTTP \d+$/.test(err.message)) return 'Failed to save - change reverted'
  return err.message
}

function patchCustomMetadata(current: CustomMetadataBookValue[], fieldId: number, value: unknown): CustomMetadataBookValue[] {
  const exists = current.some((f) => f.fieldId === fieldId)
  if (exists) {
    return current.map((f) => (f.fieldId === fieldId ? { ...f, value: value as CustomMetadataBookValue['value'] } : f))
  }
  return current
}

export function useTableCellEditor() {
  const activeCellKey = ref<string | null>(null)
  const editValue = ref<unknown>(null)
  const isSaving = ref(false)

  function cellKey(bookId: number, columnId: string): string {
    return `${bookId}:${columnId}`
  }

  function isActive(bookId: number, columnId: string): boolean {
    return activeCellKey.value === cellKey(bookId, columnId)
  }

  function activateCell(bookId: number, columnId: string, currentValue: unknown): void {
    if (isSaving.value) return
    activeCellKey.value = cellKey(bookId, columnId)
    editValue.value = Array.isArray(currentValue) ? [...(currentValue as unknown[])] : currentValue
  }

  function cancelCell(): void {
    activeCellKey.value = null
    editValue.value = null
  }

  function cancelCellIfActive(bookId: number, columnId: string): boolean {
    if (!isActive(bookId, columnId)) return false
    cancelCell()
    return true
  }

  async function saveCell(bookId: number, columnId: string, newValue: unknown, onSuccess: SaveCallback, currentBook?: BookCard): Promise<void> {
    if (isSaving.value) return
    isSaving.value = true
    const sourceCellKey = cellKey(bookId, columnId)

    try {
      if (columnId === 'readStatus') {
        const status = newValue as ReadStatus
        const res = await api(`/api/v1/books/${bookId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        })
        if (!res.ok) throw new Error(await getApiErrorMessage(res as Response))
        let updatedReadStatus: BookCard['readStatus'] = null
        try {
          updatedReadStatus = (await (res as Response).json()) as BookCard['readStatus']
        } catch {
          updatedReadStatus = { status, source: 'manual', startedAt: null, finishedAt: null, updatedAt: new Date().toISOString() }
        }
        onSuccess({ readStatus: updatedReadStatus })
      } else if (isCustomColumnId(columnId)) {
        const fieldId = parseCustomFieldId(columnId)
        if (fieldId === null) {
          toast.error(`Cannot save: invalid custom field ID in "${columnId}"`)
          if (activeCellKey.value === sourceCellKey) cancelCellIfActive(bookId, columnId)
          return
        }
        const res = await api(`/api/v1/books/${bookId}/metadata`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customMetadata: [{ fieldId, value: newValue }] }),
        })
        if (!res.ok) throw new Error(await getApiErrorMessage(res as Response))
        const existing = currentBook?.customMetadata ?? []
        onSuccess({ customMetadata: patchCustomMetadata(existing, fieldId, newValue) })
      } else {
        if (columnId === 'narrators') {
          const res = await api(`/api/v1/books/${bookId}/metadata`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audioMetadata: { narrators: newValue } }),
          })
          if (!res.ok) throw new Error(await getApiErrorMessage(res as Response))
          onSuccess({ narrators: newValue as string[] })
          if (activeCellKey.value === sourceCellKey) cancelCellIfActive(bookId, columnId)
          return
        }
        const metaKey = METADATA_FIELD_MAP[columnId as ColumnId]
        if (!metaKey) {
          toast.error(`Cannot save: unsupported field "${columnId}"`)
          if (activeCellKey.value === sourceCellKey) cancelCellIfActive(bookId, columnId)
          return
        }
        const res = await api(`/api/v1/books/${bookId}/metadata`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [metaKey]: newValue }),
        })
        if (!res.ok) throw new Error(await getApiErrorMessage(res as Response))
        onSuccess(
          columnId === 'publishedYear'
            ? ({ publishedDate: null, publishedYear: newValue as number | null } satisfies Partial<BookCard>)
            : ({ [columnId as keyof BookCard]: newValue } as Partial<BookCard>),
        )
      }
      if (activeCellKey.value === sourceCellKey) cancelCellIfActive(bookId, columnId)
    } catch (err) {
      toast.error(getToastErrorMessage(err))
      if (activeCellKey.value === sourceCellKey) cancelCellIfActive(bookId, columnId)
    } finally {
      isSaving.value = false
    }
  }

  function navigateCell(direction: 'next' | 'prev', editableColumnIds: string[], book: BookCard, currentColumnId: string): void {
    const idx = editableColumnIds.indexOf(currentColumnId)
    if (idx === -1) return
    const nextIdx = direction === 'next' ? idx + 1 : idx - 1
    if (nextIdx < 0 || nextIdx >= editableColumnIds.length) return
    const nextCol = editableColumnIds[nextIdx]!
    const colDef = COLUMN_DEF_MAP.get(nextCol)
    const targetValue = colDef?.accessor ? colDef.accessor(book) : null
    activateCell(book.id, nextCol, targetValue)
  }

  function navigateRow(direction: 'up' | 'down', books: BookCard[], currentBookId: number, columnId: string): void {
    const idx = books.findIndex((book) => book.id === currentBookId)
    if (idx === -1) return
    const nextIdx = direction === 'down' ? idx + 1 : idx - 1
    if (nextIdx < 0 || nextIdx >= books.length) return
    const nextBook = books[nextIdx]!
    const colDef = COLUMN_DEF_MAP.get(columnId)
    const targetValue = colDef?.accessor ? colDef.accessor(nextBook) : null
    activateCell(nextBook.id, columnId, targetValue)
  }

  const navigateRowUp = (books: BookCard[], currentBookId: number, columnId: string) => navigateRow('up', books, currentBookId, columnId)
  const navigateRowDown = (books: BookCard[], currentBookId: number, columnId: string) => navigateRow('down', books, currentBookId, columnId)

  return {
    activeCellKey,
    editValue,
    isSaving,
    isActive,
    activateCell,
    cancelCell,
    cancelCellIfActive,
    saveCell,
    navigateCell,
    navigateRow,
    navigateRowUp,
    navigateRowDown,
  }
}
