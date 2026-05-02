import { ref } from 'vue'
import type { GroupRule, SortSpec } from '@bookorbit/types'
import { api } from '@/lib/api'

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

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function extractFileName(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1])
    } catch {
      // Fall through to regular filename parser.
    }
  }
  const asciiMatch = disposition.match(/filename="([^"]+)"/i)
  return asciiMatch?.[1] || fallback
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
      const fileName = extractFileName(response.headers.get('Content-Disposition'), defaultName)
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
