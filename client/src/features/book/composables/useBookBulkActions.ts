import { ref } from 'vue'
import type { Ref } from 'vue'
import type { BookCard, ReadStatus, UserBookStatus } from '@bookorbit/types'
import { api } from '@/lib/api'
import { toast } from 'vue-sonner'
import { useCoverVersions } from './useCoverVersions'
import { useRefreshingBooks } from './useRefreshingBooks'
import { useBookDownload } from './useBookDownload'

export type ExportScope = 'primary' | 'all' | 'audio'

export type InFlightOp = { label: string; processed: number; total: number }

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

export function useBookBulkActions(selectedIds: Ref<Set<number>>, onDeleted: (ids: number[]) => void, books?: Ref<BookCard[]>) {
  const { bumpVersion } = useCoverVersions()
  const { markRefreshing, clearRefreshing } = useRefreshingBooks()
  const { exportBooks } = useBookDownload()

  const inFlight = ref<InFlightOp | null>(null)

  function updateSelectedBooks(ids: number[], updater: (book: BookCard) => BookCard) {
    if (!books) return
    const selected = new Set(ids)
    books.value = books.value.map((book) => (selected.has(book.id) ? updater(book) : book))
  }

  async function handleBulkRefreshMetadata() {
    const ids = [...selectedIds.value]
    if (ids.length === 0) return
    markRefreshing(ids)
    inFlight.value = { label: 'Refreshing metadata', processed: 0, total: ids.length }
    const res = await api('/api/v1/books/bulk-refresh-metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookIds: ids }),
    })
    if (!res.ok) {
      clearRefreshing(ids)
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
            const data = JSON.parse(line.slice(6))
            if (data.bookId !== undefined) {
              bumpVersion(data.bookId)
              clearRefreshing([data.bookId])
              inFlight.value = { label: 'Refreshing metadata', processed: inFlight.value!.processed + 1, total: ids.length }
            }
            if (data.done) {
              processed = data.processed
              failed = data.failed
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
    if (failed > 0) {
      toast.warning(`Refreshed ${processed} book${processed === 1 ? '' : 's'}, ${failed} failed`)
    } else {
      toast.success(`Refreshed metadata for ${processed} book${processed === 1 ? '' : 's'}`)
    }
  }

  async function handleBulkReExtractCover() {
    const ids = [...selectedIds.value]
    if (ids.length === 0) return
    markRefreshing(ids)
    inFlight.value = { label: 'Re-extracting covers', processed: 0, total: ids.length }
    const res = await api('/api/v1/books/bulk-re-extract-cover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookIds: ids }),
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
              inFlight.value = { label: 'Re-extracting covers', processed: inFlight.value!.processed + 1, total: ids.length }
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

  async function handleExport(scope: ExportScope) {
    const ids = [...selectedIds.value]
    await exportBooks(ids, scope === 'all', scope === 'audio' ? 'audio' : undefined)
  }

  async function handleBulkSetStatus(status: ReadStatus) {
    const ids = [...selectedIds.value]
    if (ids.length === 0) return
    const res = await api('/api/v1/books/bulk-set-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookIds: ids, status }),
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
    toast.success(`Updated status for ${ids.length} book${ids.length === 1 ? '' : 's'}`)
  }

  async function handleBulkSetRating(rating: number | null) {
    const ids = [...selectedIds.value]
    if (ids.length === 0) return
    const res = await api('/api/v1/books/bulk-set-rating', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookIds: ids, rating }),
    })
    if (!res.ok) {
      toast.error('Failed to update rating')
      return
    }
    updateSelectedBooks(ids, (book) => ({
      ...book,
      rating,
    }))
    const label = rating === null ? 'Cleared rating' : `Rated ${ids.length} book${ids.length === 1 ? '' : 's'} ${rating}/5`
    toast.success(label)
  }

  async function handleBulkUpdateTags(mode: 'add' | 'remove' | 'replace', tags: string[]) {
    const ids = [...selectedIds.value]
    if (ids.length === 0) return
    const res = await api('/api/v1/books/bulk-update-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookIds: ids, mode, tags }),
    })
    if (!res.ok) {
      toast.error('Failed to update tags')
      return
    }
    const verb = mode === 'add' ? 'Added tags to' : mode === 'remove' ? 'Removed tags from' : 'Replaced tags on'
    toast.success(`${verb} ${ids.length} book${ids.length === 1 ? '' : 's'}`)
  }

  async function handleBulkSetMetadataLock(locked: boolean) {
    const ids = [...selectedIds.value]
    if (ids.length === 0) return
    const res = await api('/api/v1/books/bulk-set-metadata-lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookIds: ids, locked }),
    })
    if (!res.ok) {
      toast.error(`Failed to ${locked ? 'lock' : 'unlock'} metadata`)
      return
    }
    updateSelectedBooks(ids, (book) => ({
      ...book,
      hasMetadataLocks: locked,
    }))
    toast.success(`${locked ? 'Locked' : 'Unlocked'} metadata for ${ids.length} book${ids.length === 1 ? '' : 's'}`)
  }

  async function handleDeleteSelected() {
    const ids = [...selectedIds.value]
    if (ids.length === 0) return
    const res = await api('/api/v1/books', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookIds: ids }),
    })
    if (!res.ok) {
      toast.error('Failed to delete books')
      return
    }
    onDeleted(ids)
    toast.success(`Deleted ${ids.length} book${ids.length === 1 ? '' : 's'}`)
  }

  return {
    inFlight,
    handleBulkRefreshMetadata,
    handleBulkReExtractCover,
    handleExport,
    handleBulkSetStatus,
    handleBulkSetRating,
    handleBulkUpdateTags,
    handleBulkSetMetadataLock,
    handleDeleteSelected,
  }
}
