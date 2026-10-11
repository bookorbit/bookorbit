import { ref } from 'vue'
import { api } from '@/lib/api'
import type { BookDetail, BookMetadataRefreshPreviewFields, BookMetadataRefreshPreviewResponse, MetadataCacheUsage } from '@bookorbit/types'
import { i18n } from '@/i18n'
import { showCacheFallbackToast } from '@/features/metadata-cache/lib/cache-feedback'
import { splitMetadataCacheUsage, usageFallbackProviders, type WithMetadataCacheUsage } from '@/features/metadata-cache/lib/metadata-cache'
import { metadataProviderLabel } from '../lib/metadata-refresh-feedback'
import { useCoverVersions } from './useCoverVersions'
import { useRefreshingBooks } from './useRefreshingBooks'
import { toast } from 'vue-sonner'

export type MetadataRefreshPreview = BookMetadataRefreshPreviewFields
export type MetadataRefreshPreviewResult = BookMetadataRefreshPreviewResponse

export interface MetadataRefreshResult {
  detail: BookDetail
  /** Providers the refresh could not reach live and answered from saved results instead. */
  metadataCache: MetadataCacheUsage | null
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

  async function refreshWithUsage(bookId: number): Promise<MetadataRefreshResult | null> {
    const response = await callRefresh<WithMetadataCacheUsage<BookDetail>>(bookId, false)
    if (!response) return null
    const { value, usage } = splitMetadataCacheUsage(response)
    return { detail: value, metadataCache: usage }
  }

  async function refreshAndSave(bookId: number): Promise<BookDetail | null> {
    return (await refreshWithUsage(bookId))?.detail ?? null
  }

  async function previewRefresh(bookId: number): Promise<MetadataRefreshPreviewResult | null> {
    return callRefresh<MetadataRefreshPreviewResult>(bookId, true)
  }

  async function refreshWithFeedback(bookId: number): Promise<BookDetail | null> {
    const result = await refreshWithUsage(bookId)
    if (!result) {
      toast.error(i18n.global.t('book.refreshMetadata.failed'))
      return null
    }
    bumpVersion(bookId)
    toast.success(i18n.global.t('book.refreshMetadata.success'))
    showCacheFallbackToast(usageFallbackProviders(result.metadataCache), metadataProviderLabel)
    return result.detail
  }

  return { refreshing, refreshAndSave, previewRefresh, refreshWithFeedback }
}
