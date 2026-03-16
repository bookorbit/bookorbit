import { ref } from 'vue'
import type { BookMetadataFetchConfig, BookMetadataFetchConfigOverride, BookMetadataFetchLibraryConfig } from '@projectx/types'
import { api } from '@/lib/api'

const globalConfig = ref<BookMetadataFetchConfig | null>(null)

export function useBookMetadataFetchConfig() {
  async function fetchGlobalConfig(): Promise<BookMetadataFetchConfig> {
    const res = await api('/api/v1/book-metadata-fetch/config')
    if (!res.ok) throw new Error('Failed to load config')
    const data: BookMetadataFetchConfig = await res.json()
    globalConfig.value = data
    return data
  }

  async function saveGlobalConfig(config: BookMetadataFetchConfig): Promise<BookMetadataFetchConfig> {
    const res = await api('/api/v1/book-metadata-fetch/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
    if (!res.ok) throw new Error('Failed to save config')
    const data: BookMetadataFetchConfig = await res.json()
    globalConfig.value = data
    return data
  }

  async function fetchLibraryConfig(libraryId: number): Promise<BookMetadataFetchLibraryConfig> {
    const res = await api(`/api/v1/book-metadata-fetch/config/libraries/${libraryId}`)
    if (!res.ok) throw new Error('Failed to load library config')
    return res.json()
  }

  async function saveLibraryConfig(libraryId: number, override: BookMetadataFetchConfigOverride): Promise<BookMetadataFetchConfig> {
    const res = await api(`/api/v1/book-metadata-fetch/config/libraries/${libraryId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(override ?? {}),
    })
    if (!res.ok) throw new Error('Failed to save library config')
    return res.json()
  }

  return {
    globalConfig,
    fetchGlobalConfig,
    saveGlobalConfig,
    fetchLibraryConfig,
    saveLibraryConfig,
  }
}
