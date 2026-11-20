import type { StoryGuideBuildKind, StoryGuideFixesChoice, StoryGuideStatus } from '@bookorbit/types'

import { api } from '@/lib/api'
import { apiError, jsonBody } from '@/lib/api-json'

export type StoryGuideStatusFetch =
  | { kind: 'fresh'; status: StoryGuideStatus; etag: string | null }
  | { kind: 'not-modified' }
  /** No status route for this book: a server without story guides, or a book this account cannot see. */
  | { kind: 'missing' }

function base(bookId: number): string {
  return `/api/v1/books/${bookId}/story-guide`
}

function fileBody(fileId: number | null): { fileId?: number } {
  return fileId === null ? {} : { fileId }
}

function isStatus(body: unknown): body is StoryGuideStatus {
  return typeof body === 'object' && body !== null && 'canManage' in body && 'build' in body
}

/** With `etag`, an unchanged status answers `not-modified`. The browser's cache stays out of it. */
export async function getStoryGuideStatus(bookId: number, fileId: number | null, etag: string | null): Promise<StoryGuideStatusFetch> {
  const query = fileId === null ? '' : `?fileId=${fileId}`
  const response = await api(`${base(bookId)}${query}`, {
    cache: 'no-store',
    headers: etag ? { 'If-None-Match': etag } : undefined,
  })
  if (response.status === 304) return { kind: 'not-modified' }
  if (response.status === 404) return { kind: 'missing' }
  if (!response.ok) throw await apiError(response, 'book.detail.storyGuide.failed.load')
  return { kind: 'fresh', status: (await response.json()) as StoryGuideStatus, etag: response.headers.get('ETag') }
}

/**
 * Answers the status either way: `202` once queued, and `409` when a job is already unfinished or
 * the book cannot be built, which the status then shows.
 */
export async function buildStoryGuide(bookId: number, fileId: number | null, kind: StoryGuideBuildKind): Promise<StoryGuideStatus> {
  const response = await api(base(bookId), jsonBody('POST', { ...fileBody(fileId), kind }))
  if (response.ok || response.status === 409) {
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null)
    if (isStatus(body)) return body
  }
  throw await apiError(response, 'book.detail.storyGuide.failed.build')
}

/** Try again on a paused or failed job, and Continue past an estimate. */
export async function retryStoryGuide(bookId: number, fileId: number | null): Promise<StoryGuideStatus> {
  const response = await api(`${base(bookId)}/retry`, jsonBody('POST', fileBody(fileId)))
  if (!response.ok) throw await apiError(response, 'book.detail.storyGuide.failed.retry')
  return (await response.json()) as StoryGuideStatus
}

/** Ends an unfinished job, or dismisses a failed one. */
export async function cancelStoryGuide(bookId: number, fileId: number | null): Promise<StoryGuideStatus> {
  const response = await api(`${base(bookId)}/cancel`, jsonBody('POST', fileBody(fileId)))
  if (!response.ok) throw await apiError(response, 'book.detail.storyGuide.failed.cancel')
  return (await response.json()) as StoryGuideStatus
}

/** Cancels any unfinished job, then removes the guide; its fixes for everyone go too with `delete`. */
export async function deleteStoryGuide(bookId: number, fileId: number | null, fixes: StoryGuideFixesChoice): Promise<StoryGuideStatus> {
  const params = new URLSearchParams({ fixes })
  if (fileId !== null) params.set('fileId', String(fileId))
  const response = await api(`${base(bookId)}?${params.toString()}`, { method: 'DELETE' })
  if (!response.ok) throw await apiError(response, 'book.detail.storyGuide.failed.delete')
  return (await response.json()) as StoryGuideStatus
}
