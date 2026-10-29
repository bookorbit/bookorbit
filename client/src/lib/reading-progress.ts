import type { ReadingProgressEntry, ReadingProgressListResponse, ReadingProgressWrite } from '@bookorbit/types'
import { api } from '@/lib/api'

/** One file's saved position with every field at the top level, the form the readers work in. */
export type FlatReadingProgress = {
  fileId: number
  percentage: number
  updatedAt: string | null
  cfi: string | null
  pageNumber: number | null
  textUpdatedAt: string | null
  positionSeconds: number | null
  mediaOverlayFragment: string | null
  mediaOverlaySectionIndex: number | null
  narrationPercentage: number | null
  narrationUpdatedAt: string | null
  koboLocationSource: string | null
  koboLocationType: string | null
  koboLocationValue: string | null
  koboContentSourceProgressPercent: number | null
  koreaderProgress: string | null
}

export function flattenReadingProgress(entry: ReadingProgressEntry): FlatReadingProgress {
  return {
    fileId: entry.fileId,
    percentage: entry.percentage,
    updatedAt: entry.updatedAt,
    cfi: entry.text?.cfi ?? null,
    pageNumber: entry.text?.page ?? null,
    textUpdatedAt: entry.text?.updatedAt ?? null,
    positionSeconds: entry.narration?.seconds ?? null,
    mediaOverlayFragment: entry.narration?.fragment ?? null,
    mediaOverlaySectionIndex: entry.narration?.sectionIndex ?? null,
    narrationPercentage: entry.narration?.percentage ?? null,
    narrationUpdatedAt: entry.narration?.updatedAt ?? null,
    koboLocationSource: entry.kobo?.source ?? null,
    koboLocationType: entry.kobo?.type ?? null,
    koboLocationValue: entry.kobo?.value ?? null,
    koboContentSourceProgressPercent: entry.kobo?.contentPercent ?? null,
    koreaderProgress: entry.koreader ?? null,
  }
}

async function fetchProgress(query: string): Promise<FlatReadingProgress[] | null> {
  const res = await api(`/api/v1/reading-progress?${query}`)
  if (!res.ok) return null
  const body = (await res.json()) as ReadingProgressListResponse
  return Array.isArray(body?.items) ? body.items.map(flattenReadingProgress) : null
}

/** Null when the server would not answer. */
export async function fetchFileProgress(fileId: number): Promise<FlatReadingProgress | null> {
  return (await fetchProgress(`fileId=${fileId}`))?.[0] ?? null
}

/** Every file of the book, with an empty position for one never opened; null when the server would not answer. */
export function fetchBookProgress(bookId: number): Promise<FlatReadingProgress[] | null> {
  return fetchProgress(`bookId=${bookId}`)
}

export function saveReadingProgress(write: ReadingProgressWrite): Promise<Response> {
  return api('/api/v1/reading-progress', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes: [write] }),
  })
}

export function clearReadingProgress(fileId: number): Promise<Response> {
  return api(`/api/v1/reading-progress/${fileId}`, { method: 'DELETE' })
}
