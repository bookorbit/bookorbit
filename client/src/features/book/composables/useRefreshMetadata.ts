import { ref } from 'vue'
import { api } from '@/lib/api'
import type { BookDetail, ComicMetadataFields } from '@bookorbit/types'
import { useCoverVersions } from './useCoverVersions'
import { useRefreshingBooks } from './useRefreshingBooks'
import { toast } from 'vue-sonner'

export interface MetadataRefreshPreview {
  title?: string | null
  subtitle?: string | null
  description?: string | null
  authors?: string[]
  genres?: string[]
  publisher?: string | null
  publishedYear?: number | null
  language?: string | null
  pageCount?: number | null
  seriesName?: string | null
  seriesIndex?: number | null
  coverUrl?: string
  googleBooksId?: string | null
  goodreadsId?: string | null
  amazonId?: string | null
  hardcoverId?: string | null
  openLibraryId?: string | null
  itunesId?: string | null
  audibleId?: string | null
  comicvineId?: string | null
  ranobedbId?: string | null
  audioMetadata?: {
    narrators?: string[]
    durationSeconds?: number | null
    abridged?: boolean | null
    chapters?: { title: string; startMs: number; durationMs?: number | null }[]
  }
  comicMetadata?: ComicMetadataFields
}

export function useRefreshMetadata() {
  const refreshing = ref(false)
  const { bumpVersion } = useCoverVersions()
  const { markRefreshing, clearRefreshing } = useRefreshingBooks()

  async function callRefresh<T>(bookId: number, preview: boolean): Promise<T | null> {
    refreshing.value = true
    if (!preview) markRefreshing([bookId])
    try {
      const url = `/api/v1/books/${bookId}/refresh-metadata${preview ? '?preview=true' : ''}`
      const res = await api(url, { method: 'POST' })
      if (!res.ok) return null
      return (await res.json()) as T
    } catch {
      return null
    } finally {
      if (!preview) clearRefreshing([bookId])
      refreshing.value = false
    }
  }

  async function refreshAndSave(bookId: number): Promise<BookDetail | null> {
    return callRefresh<BookDetail>(bookId, false)
  }

  async function previewRefresh(bookId: number): Promise<MetadataRefreshPreview | null> {
    return callRefresh<MetadataRefreshPreview>(bookId, true)
  }

  async function refreshWithFeedback(bookId: number): Promise<BookDetail | null> {
    const updated = await refreshAndSave(bookId)
    if (updated) {
      bumpVersion(bookId)
      toast.success('Metadata refreshed')
      return updated
    } else {
      toast.error('Metadata refresh failed')
      return null
    }
  }

  return { refreshing, refreshAndSave, previewRefresh, refreshWithFeedback }
}
