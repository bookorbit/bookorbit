import type {
  BookDuplicateDismissal,
  BookDuplicateGroupSort,
  BookDuplicateKind,
  BookDuplicateResolutionJob,
  BookDuplicateResolutionRequest,
  BookDuplicateResolutionStartResponse,
  BookDuplicateGroupsResponse,
  BookDuplicateMatchReason,
  BookDuplicateScan,
  BookDuplicateSortOrder,
  CreateBookDuplicateDismissalRequest,
  CreateBookDuplicateScanRequest,
} from '@bookorbit/types'

import { api } from '@/lib/api'
import { apiError } from '@/lib/api-json'

async function expectJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (!response.ok) throw new Error(fallbackMessage)
  return response.json() as Promise<T>
}

export async function createBookDuplicateScan(payload: CreateBookDuplicateScanRequest): Promise<BookDuplicateScan> {
  const response = await api('/api/v1/book-duplicates/scans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return expectJson(response, 'duplicate_scan_start_failed')
}

export async function getBookDuplicateScan(scanId: number): Promise<BookDuplicateScan> {
  const response = await api(`/api/v1/book-duplicates/scans/${scanId}`)
  return expectJson(response, 'duplicate_scan_status_failed')
}

export async function getActiveBookDuplicateScan(): Promise<BookDuplicateScan | null> {
  const response = await api('/api/v1/book-duplicates/scans/active')
  return expectJson(response, 'duplicate_scan_status_failed')
}

export async function getBookDuplicateGroups(
  scanId: number,
  params: {
    page: number
    pageSize: number
    reason?: BookDuplicateMatchReason
    sortBy?: BookDuplicateGroupSort
    order?: BookDuplicateSortOrder
    kind?: BookDuplicateKind
  },
): Promise<BookDuplicateGroupsResponse> {
  const query = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) })
  if (params.kind && params.kind !== 'duplicate') query.set('kind', params.kind)
  if (params.reason) query.set('reason', params.reason)
  if (params.sortBy) query.set('sortBy', params.sortBy)
  if (params.order) query.set('order', params.order)
  const response = await api(`/api/v1/book-duplicates/scans/${scanId}/groups?${query.toString()}`)
  return expectJson(response, 'duplicate_scan_results_failed')
}

export async function dismissBookDuplicateGroup(payload: CreateBookDuplicateDismissalRequest): Promise<void> {
  const response = await api('/api/v1/book-duplicates/dismissals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error('duplicate_dismiss_failed')
}

export async function getBookDuplicateDismissals(): Promise<BookDuplicateDismissal[]> {
  const response = await api('/api/v1/book-duplicates/dismissals')
  return expectJson(response, 'duplicate_dismissals_failed')
}

export async function restoreBookDuplicateDismissal(bookIdA: number, bookIdB: number, kind: BookDuplicateKind = 'duplicate'): Promise<void> {
  const query = kind === 'duplicate' ? '' : `?kind=${kind}`
  const response = await api(`/api/v1/book-duplicates/dismissals/${bookIdA}/${bookIdB}${query}`, { method: 'DELETE' })
  if (!response.ok) throw new Error('duplicate_restore_failed')
}

export async function startBookDuplicateResolution(payload: BookDuplicateResolutionRequest): Promise<BookDuplicateResolutionStartResponse> {
  const response = await api('/api/v1/book-duplicates/resolutions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw await apiError(response, 'tools.bookDuplicates.errors.resolve')
  return response.json() as Promise<BookDuplicateResolutionStartResponse>
}

export async function getBookDuplicateResolution(jobId: number): Promise<BookDuplicateResolutionJob> {
  const response = await api(`/api/v1/book-duplicates/resolutions/${jobId}`)
  if (!response.ok) throw await apiError(response, 'tools.bookDuplicates.errors.status')
  return response.json() as Promise<BookDuplicateResolutionJob>
}
