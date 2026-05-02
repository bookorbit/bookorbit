import { ref } from 'vue'
import type { Ref } from 'vue'
import {
  BOOK_METADATA_LOCK_FIELDS,
  type BookCard,
  type BookDetail,
  type BookMetadataLockField,
  type GroupRule,
  type ReadStatus,
  type SortSpec,
  type UserBookStatus,
} from '@bookorbit/types'
import { api } from '@/lib/api'
import { toast } from 'vue-sonner'
import { useCoverVersions } from './useCoverVersions'
import { useRefreshingBooks } from './useRefreshingBooks'
import { useBookDownload } from './useBookDownload'
import { useBookRefreshFeedback } from './useBookRefreshFeedback'
import { detectChangedColumns, mergeBookCardWithDetail } from '@/features/book/lib/book-card-mapper'

export type ExportScope = 'primary' | 'all' | 'audio'
export type BulkEditableField = 'seriesName' | 'publisher' | 'language' | 'publishedYear' | 'authors' | 'genres' | 'tags' | 'narrators'
export type BulkEditableValue = string | number | string[] | null
const BULK_FIELD_LOCK_FIELD: Record<BulkEditableField, BookMetadataLockField> = {
  seriesName: 'seriesName',
  publisher: 'publisher',
  language: 'language',
  publishedYear: 'publishedYear',
  authors: 'authors',
  genres: 'genres',
  tags: 'tags',
  narrators: 'narrators',
}

export type InFlightOp = { label: string; processed: number; total: number; failed?: number }

export type QuerySelectionState = {
  libraryId?: number
  filter?: GroupRule
  q?: string
  sort?: SortSpec[]
  total: number
}

function buildLocalReadStatus(status: ReadStatus, existing: UserBookStatus | null, nowIso: string): UserBookStatus {
  switch (status) {
    case 'unread':
    case 'want_to_read':
      return {
        status,
        source: 'manual',
        startedAt: null,
        finishedAt: null,
        updatedAt: nowIso,
      }
    case 'reading':
    case 'on_hold':
    case 'rereading':
    case 'skimmed':
    case 'abandoned':
      return {
        status,
        source: 'manual',
        startedAt: existing?.startedAt ?? nowIso,
        finishedAt: null,
        updatedAt: nowIso,
      }
    case 'read':
      return {
        status,
        source: 'manual',
        startedAt: existing?.startedAt ?? nowIso,
        finishedAt: nowIso,
        updatedAt: nowIso,
      }
  }
}

export function useBookBulkActions(
  selectedIds: Ref<Set<number>>,
  onDeleted: (ids: number[]) => void,
  books?: Ref<BookCard[]>,
  onBulkRefreshCompleted?: () => void | Promise<void>,
  querySelection?: Ref<QuerySelectionState | null>,
) {
  const { bumpVersion } = useCoverVersions()
  const { markRefreshing, clearRefreshing } = useRefreshingBooks()
  const refreshFeedback = useBookRefreshFeedback()
  const { exportBooks } = useBookDownload()

  const inFlight = ref<InFlightOp | null>(null)

  function getSelectionPayload(): { bookIds: number[] } | { query: Omit<QuerySelectionState, 'total'> } {
    if (querySelection?.value) {
      const { libraryId, filter, q, sort } = querySelection.value
      return { query: { libraryId, filter, q, sort } }
    }
    return { bookIds: [...selectedIds.value] }
  }

  function hasSelection(): boolean {
    if (querySelection?.value) return querySelection.value.total > 0
    return selectedIds.value.size > 0
  }

  function updateSelectedBooks(ids: number[], updater: (book: BookCard) => BookCard) {
    if (!books) return
    const selected = new Set(ids)
    books.value = books.value.map((book) => (selected.has(book.id) ? updater(book) : book))
  }

  async function handleBulkRefreshMetadata() {
    if (!hasSelection()) return
    const ids = querySelection?.value ? [] : [...selectedIds.value]
    const total = querySelection?.value ? querySelection.value.total : ids.length
    markRefreshing(ids)
    refreshFeedback.markRefreshingMany(ids)
    inFlight.value = { label: 'Refreshing metadata', processed: 0, total, failed: 0 }
    const res = await api('/api/v1/books/bulk-refresh-metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getSelectionPayload()),
    })
    if (!res.ok) {
      clearRefreshing(ids)
      refreshFeedback.markFailedMany(ids, 'Metadata refresh failed')
      inFlight.value = null
      toast.error('Failed to refresh metadata')
      return
    }
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let processed = 0
    let failed = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        for (const line of decoder.decode(value, { stream: true }).split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6)) as {
              bookId?: number
              success?: boolean
              detail?: BookDetail
              error?: string
              done?: boolean
              processed?: number
              failed?: number
            }
            if (data.bookId !== undefined) {
              const bookId = data.bookId
              const succeeded = data.success !== false
              let changedColumns: ReturnType<typeof detectChangedColumns> = []

              if (succeeded && books && data.detail) {
                const index = books.value.findIndex((book) => book.id === bookId)
                const previous = index !== -1 ? books.value[index] : undefined
                if (previous) {
                  const merged = mergeBookCardWithDetail(previous, data.detail)
                  changedColumns = detectChangedColumns(previous, merged)
                  books.value = books.value.map((book, i) => (i === index ? merged : book))
                }
              }

              if (succeeded) refreshFeedback.markSuccess(bookId, changedColumns)
              else refreshFeedback.markFailed(bookId, data.error || 'Metadata refresh failed')

              bumpVersion(bookId)
              clearRefreshing([bookId])
              const prev: InFlightOp = inFlight.value ?? { label: 'Refreshing metadata', processed: 0, total, failed: 0 }
              inFlight.value = {
                label: 'Refreshing metadata',
                processed: prev.processed + 1,
                total,
                failed: (prev.failed ?? 0) + (succeeded ? 0 : 1),
              }
            }
            if (data.done) {
              processed = typeof data.processed === 'number' ? data.processed : processed
              failed = typeof data.failed === 'number' ? data.failed : failed
            }
          } catch {
            /* ignore malformed SSE line */
          }
        }
      }
    } finally {
      for (const id of ids) {
        if (refreshFeedback.getFeedback(id)?.state === 'refreshing') {
          refreshFeedback.markFailed(id, 'Metadata refresh interrupted')
        }
      }
      clearRefreshing(ids)
      inFlight.value = null
    }
    if (onBulkRefreshCompleted) {
      try {
        await onBulkRefreshCompleted()
      } catch {
        // Ignore refresh-list failure and still surface the bulk action outcome.
      }
    }
    if (failed > 0) {
      toast.warning(`Refreshed ${processed} book${processed === 1 ? '' : 's'}, ${failed} failed`)
    } else {
      toast.success(`Refreshed metadata for ${processed} book${processed === 1 ? '' : 's'}`)
    }
  }

  async function handleBulkReExtractCover() {
    if (!hasSelection()) return
    const ids = querySelection?.value ? [] : [...selectedIds.value]
    const total = querySelection?.value ? querySelection.value.total : ids.length
    markRefreshing(ids)
    inFlight.value = { label: 'Re-extracting covers', processed: 0, total }
    const res = await api('/api/v1/books/bulk-re-extract-cover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getSelectionPayload()),
    })
    if (!res.ok) {
      clearRefreshing(ids)
      inFlight.value = null
      toast.error('Failed to re-extract covers')
      return
    }
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let processed = 0
    let updated = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        for (const line of decoder.decode(value, { stream: true }).split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.bookId !== undefined) {
              bumpVersion(data.bookId)
              clearRefreshing([data.bookId])
              inFlight.value = { label: 'Re-extracting covers', processed: inFlight.value!.processed + 1, total }
            }
            if (data.done) {
              processed = data.processed
              updated = data.updated
            }
          } catch {
            /* ignore malformed SSE line */
          }
        }
      }
    } finally {
      clearRefreshing(ids)
      inFlight.value = null
    }
    toast.success(`Re-extracted ${updated} of ${processed} cover${processed === 1 ? '' : 's'}`)
  }

  async function handleDownloadFiles(scope: ExportScope) {
    const ids = [...selectedIds.value]
    await exportBooks(ids, scope === 'all', scope === 'audio' ? 'audio' : undefined)
  }

  async function handleBulkSetStatus(status: ReadStatus) {
    if (!hasSelection()) return
    const ids = querySelection?.value ? [] : [...selectedIds.value]
    const res = await api('/api/v1/books/bulk-set-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...getSelectionPayload(), status }),
    })
    if (!res.ok) {
      toast.error('Failed to update status')
      return
    }
    const nowIso = new Date().toISOString()
    updateSelectedBooks(ids, (book) => ({
      ...book,
      readStatus: buildLocalReadStatus(status, book.readStatus, nowIso),
    }))
    const count = querySelection?.value ? querySelection.value.total : ids.length
    toast.success(`Updated status for ${count} book${count === 1 ? '' : 's'}`)
  }

  async function handleBulkSetRating(rating: number | null) {
    if (!hasSelection()) return
    const ids = querySelection?.value ? [] : [...selectedIds.value]
    const res = await api('/api/v1/books/bulk-set-rating', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...getSelectionPayload(), rating }),
    })
    if (!res.ok) {
      toast.error('Failed to update rating')
      return
    }
    const editableIds = books
      ? ids.filter((id) => {
          const book = books.value.find((entry) => entry.id === id)
          return book ? !book.lockedFields.includes('rating') : true
        })
      : ids
    const skippedCount = ids.length - editableIds.length
    updateSelectedBooks(editableIds, (book) => ({
      ...book,
      rating,
    }))
    const count = querySelection?.value ? querySelection.value.total : editableIds.length
    const baseLabel =
      rating === null ? `Cleared rating for ${count} book${count === 1 ? '' : 's'}` : `Rated ${count} book${count === 1 ? '' : 's'} ${rating}/5`
    const label = skippedCount > 0 ? `${baseLabel} (${skippedCount} locked skipped)` : baseLabel
    toast.success(label)
  }

  async function handleBulkUpdateTags(mode: 'add' | 'remove' | 'replace', tags: string[]) {
    if (!hasSelection()) return
    const ids = querySelection?.value ? [] : [...selectedIds.value]
    const res = await api('/api/v1/books/bulk-update-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...getSelectionPayload(), mode, tags }),
    })
    if (!res.ok) {
      toast.error('Failed to update tags')
      return
    }
    const verb = mode === 'add' ? 'Added tags to' : mode === 'remove' ? 'Removed tags from' : 'Replaced tags on'
    const count = querySelection?.value ? querySelection.value.total : ids.length
    toast.success(`${verb} ${count} book${count === 1 ? '' : 's'}`)
  }

  async function handleBulkSetField(field: BulkEditableField, value: BulkEditableValue) {
    if (!hasSelection()) return
    const ids = querySelection?.value ? [] : [...selectedIds.value]
    const lockField = BULK_FIELD_LOCK_FIELD[field]
    const toStringList = (raw: BulkEditableValue): string[] => {
      if (Array.isArray(raw)) return raw
      if (raw === null) return []
      const trimmed = String(raw).trim()
      return trimmed.length > 0 ? [trimmed] : []
    }
    const res = await api('/api/v1/books/bulk-set-metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...getSelectionPayload(), field, value }),
    })
    if (!res.ok) {
      toast.error(`Failed to update ${field}`)
      return
    }
    const editableIds = books
      ? ids.filter((id) => {
          const book = books.value.find((entry) => entry.id === id)
          return book ? !book.lockedFields.includes(lockField) : true
        })
      : ids
    const skippedCount = ids.length - editableIds.length
    updateSelectedBooks(editableIds, (book) => {
      switch (field) {
        case 'seriesName':
          return { ...book, seriesName: typeof value === 'string' ? value : value === null ? null : String(value) }
        case 'publisher':
          return { ...book, publisher: typeof value === 'string' ? value : value === null ? null : String(value) }
        case 'language':
          return { ...book, language: typeof value === 'string' ? value : value === null ? null : String(value) }
        case 'publishedYear':
          return {
            ...book,
            publishedYear: typeof value === 'number' ? value : value === null ? null : Number.isFinite(Number(value)) ? Number(value) : null,
          }
        case 'authors':
          return { ...book, authors: toStringList(value) }
        case 'genres':
          return { ...book, genres: toStringList(value) }
        case 'narrators':
          return { ...book, narrators: toStringList(value) }
        case 'tags':
          return book
      }
    })
    const count = querySelection?.value ? querySelection.value.total : editableIds.length
    if (skippedCount > 0) {
      toast.success(`Updated ${field} for ${count} book${count === 1 ? '' : 's'} (${skippedCount} locked skipped)`)
      return
    }
    toast.success(`Updated ${field} for ${count} book${count === 1 ? '' : 's'}`)
  }

  async function handleBulkSetMetadataLock(locked: boolean) {
    if (!hasSelection()) return
    const ids = querySelection?.value ? [] : [...selectedIds.value]
    const res = await api('/api/v1/books/bulk-set-metadata-lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...getSelectionPayload(), locked }),
    })
    if (!res.ok) {
      toast.error(`Failed to ${locked ? 'lock' : 'unlock'} metadata`)
      return
    }
    updateSelectedBooks(ids, (book) => ({
      ...book,
      hasMetadataLocks: locked,
      lockedFields: locked ? [...BOOK_METADATA_LOCK_FIELDS] : [],
    }))
    const count = querySelection?.value ? querySelection.value.total : ids.length
    toast.success(`${locked ? 'Locked' : 'Unlocked'} metadata for ${count} book${count === 1 ? '' : 's'}`)
  }

  async function handleDeleteSelected() {
    if (!hasSelection()) return
    const ids = querySelection?.value ? [] : [...selectedIds.value]
    const count = querySelection?.value ? querySelection.value.total : ids.length
    const res = await api('/api/v1/books', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getSelectionPayload()),
    })
    if (!res.ok) {
      toast.error('Failed to delete books')
      return
    }
    onDeleted(ids)
    toast.success(`Deleted ${count} book${count === 1 ? '' : 's'}`)
  }

  return {
    inFlight,
    handleBulkRefreshMetadata,
    handleBulkReExtractCover,
    handleDownloadFiles,
    handleBulkSetStatus,
    handleBulkSetRating,
    handleBulkUpdateTags,
    handleBulkSetField,
    handleBulkSetMetadataLock,
    handleDeleteSelected,
  }
}
