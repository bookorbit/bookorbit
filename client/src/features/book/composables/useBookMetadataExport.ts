import { ref } from 'vue'
import type { GroupRule, SortSpec } from '@bookorbit/types'
import { api } from '@/lib/api'
import { fileNameFromContentDisposition, triggerBlobDownload } from '@/lib/download'

export type MetadataExportFormat = 'csv' | 'json'
export type MetadataExportScope = 'selected' | 'all-matching'
export type MetadataExportViewType = 'library' | 'collection' | 'smartScope'
export type MetadataExportColumnsMode = 'canonical' | 'visible'

export type MetadataExportQuery = {
  libraryId?: number
  filter?: GroupRule
  q?: string
  sort?: SortSpec[]
}

export type MetadataExportOptions = {
  includePersonalData: boolean
  includeFilePaths: boolean
  includeContextMeta: boolean
  columnsMode: MetadataExportColumnsMode
  visibleColumns: string[]
}

export type MetadataExportRequest = {
  scope: MetadataExportScope
  format: MetadataExportFormat
  viewType: MetadataExportViewType
  selectedBookIds: number[]
  allMatchingQuery?: MetadataExportQuery
  sort?: SortSpec[]
  options: MetadataExportOptions
}

export type MetadataExportPreflight = {
  schemaVersion: number
  rowCount: number
  estimatedBytes: number
  sizeCategory: 'small' | 'medium' | 'large'
  fileName: string
  scope: MetadataExportScope
  format: MetadataExportFormat
}

type MetadataExportPayload = {
  bookIds?: number[]
  query?: MetadataExportQuery
  sort?: SortSpec[]
  format: MetadataExportFormat
  viewType: MetadataExportViewType
  options: MetadataExportOptions
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const raw = await response.text()
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw) as { message?: string | string[]; error?: string }
    if (Array.isArray(parsed.message) && parsed.message.length > 0) return parsed.message.join(', ')
    if (typeof parsed.message === 'string' && parsed.message.length > 0) return parsed.message
    if (typeof parsed.error === 'string' && parsed.error.length > 0) return parsed.error
  } catch {
    // Fall back to raw response text.
  }
  return raw
}

function toPayload(request: MetadataExportRequest): MetadataExportPayload {
  if (request.scope === 'all-matching') {
    if (!request.allMatchingQuery) {
      throw new Error('All-matching metadata export requires a query payload')
    }
    return {
      query: request.allMatchingQuery,
      format: request.format,
      viewType: request.viewType,
      options: request.options,
    }
  }

  return {
    bookIds: request.selectedBookIds,
    sort: request.sort,
    format: request.format,
    viewType: request.viewType,
    options: request.options,
  }
}

export function useBookMetadataExport() {
  const loading = ref(false)

  async function preflight(request: MetadataExportRequest): Promise<MetadataExportPreflight> {
    const response = await api('/api/v1/books/metadata-export/preflight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toPayload(request)),
    })
    if (!response.ok) {
      const message = await readErrorMessage(response, 'Failed to prepare metadata export')
      throw new Error(message)
    }
    return (await response.json()) as MetadataExportPreflight
  }

  async function download(request: MetadataExportRequest): Promise<MetadataExportPreflight> {
    loading.value = true
    try {
      const payload = toPayload(request)
      const response = await api('/api/v1/books/metadata-export/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        const message = await readErrorMessage(response, 'Failed to export metadata')
        throw new Error(message)
      }
      const blob = await response.blob()
      const defaultName = `bookorbit-${request.viewType}-${request.scope}.${request.format}`
      const fileName = fileNameFromContentDisposition(response.headers.get('Content-Disposition'), defaultName)
      triggerBlobDownload(blob, fileName)

      return {
        schemaVersion: 1,
        rowCount: 0,
        estimatedBytes: blob.size,
        sizeCategory: blob.size < 5 * 1024 * 1024 ? 'small' : blob.size < 25 * 1024 * 1024 ? 'medium' : 'large',
        fileName,
        scope: request.scope,
        format: request.format,
      }
    } finally {
      loading.value = false
    }
  }

  return {
    loading,
    preflight,
    download,
  }
}
