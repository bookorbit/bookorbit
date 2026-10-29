import type {
  ReadingAttemptOutcome,
  ReadingHistoryMarks,
  ReadingHistoryPage,
  ReadingHistoryRatingResponse,
  ReadingHistorySort,
  ReadingHistorySummary,
} from '@bookorbit/types'
import { api } from '@/lib/api'

export interface ReadingHistoryPeriodParams {
  year: number | null
  quarter: number | null
}

export interface ReadingHistoryListParams extends ReadingHistoryPeriodParams {
  outcomes: ReadingAttemptOutcome[]
  search: string
  bookId: number | null
  sort: ReadingHistorySort
}

function periodParams(params: ReadingHistoryPeriodParams): URLSearchParams {
  const search = new URLSearchParams()
  if (params.year !== null) search.set('year', String(params.year))
  if (params.year !== null && params.quarter !== null) search.set('quarter', String(params.quarter))
  return search
}

async function readJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what} failed: ${res.status}`)
  return res.json() as Promise<T>
}

export async function fetchReadingHistoryPage(
  params: ReadingHistoryListParams,
  offset: number,
  limit: number,
  signal?: AbortSignal,
): Promise<ReadingHistoryPage> {
  const search = periodParams(params)
  search.set('outcomes', params.outcomes.join(','))
  if (params.search.trim()) search.set('search', params.search.trim())
  if (params.bookId !== null) search.set('bookId', String(params.bookId))
  search.set('sort', params.sort)
  search.set('offset', String(offset))
  search.set('limit', String(limit))
  return readJson(await api(`/api/v1/reading-history?${search}`, { signal }), 'Reading history request')
}

export async function fetchReadingHistorySummary(params: ReadingHistoryPeriodParams, signal?: AbortSignal): Promise<ReadingHistorySummary> {
  const search = periodParams(params).toString()
  return readJson(await api(`/api/v1/reading-history/summary${search ? `?${search}` : ''}`, { signal }), 'Reading history summary request')
}

export async function fetchReadMarks(attemptId: number): Promise<ReadingHistoryMarks> {
  return readJson(await api(`/api/v1/reading-history/${attemptId}/marks`), 'Read marks request')
}

export async function updateReadRating(attemptId: number, rating: number | null): Promise<ReadingHistoryRatingResponse> {
  return readJson(
    await api(`/api/v1/reading-history/${attemptId}/rating`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating }),
    }),
    'Read rating request',
  )
}
