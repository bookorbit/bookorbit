import { api } from '@/lib/api'
import type { BulkRenamePreviewPage, BulkRenameStatus } from '@bookorbit/types'

function toQuery(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined)
  if (entries.length === 0) return ''
  return '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()
}

export async function fetchBulkRenamePreview(
  libraryId: number,
  page: number,
  pageSize: number,
  status?: BulkRenameStatus,
): Promise<BulkRenamePreviewPage> {
  const query = toQuery({ page, pageSize, status })
  const res = await api(`/api/v1/libraries/${libraryId}/bulk-rename/preview${query}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchBulkRenameStatus(libraryId: number): Promise<{ running: boolean }> {
  const res = await api(`/api/v1/libraries/${libraryId}/bulk-rename/status`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export function executeBulkRename(libraryId: number, signal?: AbortSignal): Promise<Response> {
  return api(`/api/v1/libraries/${libraryId}/bulk-rename/execute`, {
    method: 'POST',
    signal,
  })
}
