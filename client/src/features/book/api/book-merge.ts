import type { BookMergeJob, BookMergePreviewRequest, BookMergePreviewResponse, BookMergeRequest, BookMergeStartResponse } from '@bookorbit/types'
import { apiJson, jsonBody } from '@/lib/api-json'

export function fetchMergePreview(body: BookMergePreviewRequest, signal?: AbortSignal): Promise<BookMergePreviewResponse> {
  return apiJson('/api/v1/books/merge/preview', { ...jsonBody('POST', body), signal }, 'book.merge.errors.previewFailed')
}

export function startMerge(body: BookMergeRequest): Promise<BookMergeStartResponse> {
  return apiJson('/api/v1/books/merge', jsonBody('POST', body), 'book.merge.errors.startFailed')
}

export function fetchMergeJob(jobId: number, signal?: AbortSignal): Promise<BookMergeJob> {
  return apiJson(`/api/v1/books/merge/jobs/${jobId}`, { signal }, 'book.merge.errors.jobFailed')
}
