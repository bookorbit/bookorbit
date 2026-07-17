import { ref } from 'vue'
import { api } from '@/lib/api'
import type { ComicMetadataFields, CustomMetadataBookValueInput } from '@bookorbit/types'

export interface FileMetadata {
  title?: string | null
  subtitle?: string | null
  description?: string | null
  publisher?: string | null
  publishedDate?: string | null
  publishedYear?: number | null
  language?: string | null
  pageCount?: number | null
  seriesName?: string | null
  seriesIndex?: number | null
  isbn10?: string | null
  isbn13?: string | null
  googleBooksId?: string | null
  goodreadsId?: string | null
  amazonId?: string | null
  hardcoverId?: string | null
  hardcoverEditionId?: string | null
  openLibraryId?: string | null
  itunesId?: string | null
  audibleId?: string | null
  librofmId?: string | null
  koboId?: string | null
  comicvineId?: string | null
  ranobedbId?: string | null
  lubimyczytacId?: string | null
  aladinId?: string | null
  authors?: string[]
  genres?: string[]
  narrators?: string[]
  durationSeconds?: number | null
  comicMetadata?: ComicMetadataFields
  customMetadata?: CustomMetadataBookValueInput[]
}

export function useFileMetadata() {
  const loading = ref(false)

  async function loadFromFile(bookId: number): Promise<FileMetadata | null> {
    loading.value = true
    try {
      const res = await api(`/api/v1/books/${bookId}/metadata-from-file`)
      if (!res.ok) return null
      return (await res.json()) as FileMetadata
    } catch {
      return null
    } finally {
      loading.value = false
    }
  }

  return { loading, loadFromFile }
}
