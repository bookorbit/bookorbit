import type {
  ChapterHealthCategory,
  ChapterHealthPage,
  ChapterHealthSummary,
  ChapterLookupQueueState,
  EnqueueChapterLookupRequest,
  EnqueueChapterLookupResult,
} from '@bookorbit/types'

import { apiError, apiJson, jsonBody } from '@/lib/api-json'
import { api } from '@/lib/api'

const BASE = '/api/v1/chapter-health'

function scope(libraryId: number | null): string {
  return libraryId === null ? '' : `libraryId=${libraryId}`
}

export function getChapterHealthSummary(libraryId: number | null): Promise<ChapterHealthSummary> {
  return apiJson(`${BASE}/summary?${scope(libraryId)}`, undefined, 'tools.chapterHealth.errors.load')
}

export function getChapterHealthBooks(params: {
  category: ChapterHealthCategory
  libraryId: number | null
  page: number
  pageSize: number
}): Promise<ChapterHealthPage> {
  const query = new URLSearchParams({ category: params.category, page: String(params.page), pageSize: String(params.pageSize) })
  if (params.libraryId !== null) query.set('libraryId', String(params.libraryId))
  return apiJson(`${BASE}/books?${query.toString()}`, undefined, 'tools.chapterHealth.errors.load')
}

export function enqueueChapterLookups(payload: EnqueueChapterLookupRequest): Promise<EnqueueChapterLookupResult> {
  return apiJson(`${BASE}/lookups`, jsonBody('POST', payload), 'tools.chapterHealth.errors.enqueue')
}

export function getChapterLookupState(): Promise<ChapterLookupQueueState> {
  return apiJson(`${BASE}/lookups/state`, undefined, 'tools.chapterHealth.errors.load')
}

export function cancelChapterLookups(): Promise<{ removed: number }> {
  return apiJson(`${BASE}/lookups/queued`, { method: 'DELETE' }, 'tools.chapterHealth.errors.cancel')
}

export function clearFinishedChapterLookups(): Promise<{ removed: number }> {
  return apiJson(`${BASE}/lookups/finished`, { method: 'DELETE' }, 'tools.chapterHealth.errors.cancel')
}

export async function dismissChapterReview(bookId: number): Promise<void> {
  const response = await api(`${BASE}/lookups/${bookId}`, { method: 'DELETE' })
  if (!response.ok) throw await apiError(response, 'tools.chapterHealth.errors.dismiss')
}
