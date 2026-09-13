import { api } from '@/lib/api'
import type { BulkRenameExecuteRequest, BulkRenamePreviewPage, BulkRenameStatus } from '@bookorbit/types'

/** Carries the status code so callers can report a failure without inventing English copy. */
export class BulkRenameHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`)
    this.name = 'BulkRenameHttpError'
  }
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined)
  if (entries.length === 0) return ''
  return '?' + new URLSearchParams(entries.map(([key, value]) => [key, String(value)])).toString()
}

export async function fetchBulkRenamePreview(
  libraryId: number,
  page: number,
  pageSize: number,
  status?: BulkRenameStatus,
  search?: string,
): Promise<BulkRenamePreviewPage> {
  const query = toQuery({ page, pageSize, status, search: search?.trim() || undefined })
  const res = await api(`/api/v1/libraries/${libraryId}/bulk-rename/preview${query}`)
  if (!res.ok) throw new BulkRenameHttpError(res.status)
  return res.json()
}

export async function fetchBulkRenameStatus(libraryId: number): Promise<{ running: boolean }> {
  const res = await api(`/api/v1/libraries/${libraryId}/bulk-rename/status`)
  if (!res.ok) throw new BulkRenameHttpError(res.status)
  return res.json()
}

/** Omitting `excludeBookIds` renames every candidate; passing them holds those books back. */
export function executeBulkRename(libraryId: number, selection: BulkRenameExecuteRequest, signal?: AbortSignal): Promise<Response> {
  return api(`/api/v1/libraries/${libraryId}/bulk-rename/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(selection),
    signal,
  })
}
