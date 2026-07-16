import type { BookDuplicateGroupsResponse, BookDuplicateMatchReason, BookDuplicateScan, CreateBookDuplicateScanRequest } from '@bookorbit/types'

import { api } from '@/lib/api'

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
  params: { page: number; pageSize: number; reason?: BookDuplicateMatchReason },
): Promise<BookDuplicateGroupsResponse> {
  const query = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) })
  if (params.reason) query.set('reason', params.reason)
  const response = await api(`/api/v1/book-duplicates/scans/${scanId}/groups?${query.toString()}`)
  return expectJson(response, 'duplicate_scan_results_failed')
}

export async function deleteDuplicateBooks(bookIds: number[]): Promise<void> {
  const response = await api('/api/v1/books', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookIds }),
  })
  if (!response.ok) throw new Error('duplicate_delete_failed')
}
