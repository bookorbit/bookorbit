import type { Ref } from 'vue'
import { api } from '@/lib/api'
import { toast } from 'vue-sonner'
import { useCoverVersions } from './useCoverVersions'
import { useRefreshingBooks } from './useRefreshingBooks'

export function useBookBulkActions(selectedIds: Ref<Set<number>>, onDeleted: (ids: number[]) => void) {
  const { bumpVersion } = useCoverVersions()
  const { markRefreshing, clearRefreshing } = useRefreshingBooks()

  async function handleBulkRefreshMetadata() {
    const ids = [...selectedIds.value]
    if (ids.length === 0) return
    markRefreshing(ids)
    const res = await api('/api/v1/books/bulk-refresh-metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookIds: ids }),
    })
    if (!res.ok) {
      clearRefreshing(ids)
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
    const res = await api('/api/v1/books/bulk-re-extract-cover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookIds: ids }),
    })
    if (!res.ok) {
      clearRefreshing(ids)
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
    }
    toast.success(`Re-extracted ${updated} of ${processed} cover${processed === 1 ? '' : 's'}`)
  }

  async function handleExport(allFormats: boolean) {
    const ids = [...selectedIds.value]
    if (ids.length === 0) return
    const toastId = toast.loading(`Preparing ${ids.length} book${ids.length === 1 ? '' : 's'} for download...`)
    const res = await api('/api/v1/books/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookIds: ids, allFormats }),
    })
    toast.dismiss(toastId)
    if (!res.ok) {
      toast.error('Export failed')
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'books.zip'
    a.click()
    URL.revokeObjectURL(url)
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
    handleBulkRefreshMetadata,
    handleBulkReExtractCover,
    handleExport,
    handleDeleteSelected,
  }
}
