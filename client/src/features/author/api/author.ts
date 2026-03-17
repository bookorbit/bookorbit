import { api } from '@/lib/api'
import type {
  AuthorsPage,
  AuthorDetail,
  AuthorDuplicateSuggestion,
  AuthorInsights,
  AuthorMetadataCandidate,
  AuthorMetadataProviderKey,
  BooksPage,
  MergeAuthorsResult,
} from '@projectx/types'
import type { AuthorBookSort, AuthorListSort, SortDirection } from '../types/author'

type ListAuthorsParams = {
  q?: string
  page: number
  size: number
  sort: AuthorListSort
  order: SortDirection
  libraryId?: number | null
  hasPhoto?: boolean | null
  minBookCount?: number | null
}

type ListAuthorBooksParams = {
  page: number
  size: number
  sort: AuthorBookSort
  order: SortDirection
  libraryId?: number | null
}

export type UpdateAuthorPayload = {
  name?: string
  sortName?: string | null
  description?: string | null
}

export type MergeAuthorsPayload = {
  targetAuthorId: number
  sourceAuthorIds: number[]
}

export type DeleteAuthorsPayload = {
  authorIds: number[]
}

type AuthorInsightsParams = {
  libraryId?: number | null
  windowDays?: number
  limit?: number
}

type DuplicateSuggestionsParams = {
  libraryId?: number | null
  limit?: number
  poolSize?: number
  minConfidence?: number
}

type AuthorMetadataSearchParams = {
  q: string
  region?: string
  limit?: number
  providers?: AuthorMetadataProviderKey[]
}

export type BulkAuthorMetadataRefreshEvent = {
  authorId: number
  updated: boolean
  imageUpdated?: boolean
  imageUrl?: string | null
  error?: string
}

export type BulkAuthorMetadataRefreshResult = {
  processed: number
  failed: number
  updated: number
}

function toQuery(params: Record<string, string | number | (string | number)[] | null | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      search.set(key, value.join(','))
      continue
    }
    search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

export async function fetchAuthors(params: ListAuthorsParams): Promise<AuthorsPage> {
  const query = toQuery({
    q: params.q,
    page: params.page,
    size: params.size,
    sort: params.sort,
    order: params.order,
    libraryId: params.libraryId ?? undefined,
    hasPhoto: params.hasPhoto != null ? String(params.hasPhoto) : undefined,
    minBookCount: params.minBookCount ?? undefined,
  })

  const res = await api(`/api/v1/authors${query}`)
  if (!res.ok) throw new Error('Failed to load authors')
  return res.json()
}

export async function fetchAuthor(id: number): Promise<AuthorDetail> {
  const res = await api(`/api/v1/authors/${id}`)
  if (!res.ok) throw new Error('Failed to load author')
  return res.json()
}

export async function fetchAuthorBooks(authorId: number, params: ListAuthorBooksParams): Promise<BooksPage> {
  const query = toQuery({
    page: params.page,
    size: params.size,
    sort: params.sort,
    order: params.order,
    libraryId: params.libraryId ?? undefined,
  })

  const res = await api(`/api/v1/authors/${authorId}/books${query}`)
  if (!res.ok) throw new Error('Failed to load author books')
  return res.json()
}

export async function updateAuthor(authorId: number, payload: UpdateAuthorPayload): Promise<AuthorDetail> {
  const res = await api(`/api/v1/authors/${authorId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Failed to update author')
  return res.json()
}

export async function mergeAuthors(payload: MergeAuthorsPayload): Promise<MergeAuthorsResult> {
  const res = await api('/api/v1/authors/merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Failed to merge authors')
  return res.json()
}

export async function deleteAuthors(payload: DeleteAuthorsPayload): Promise<{ deletedAuthorIds: number[]; affectedBookCount: number }> {
  const res = await api('/api/v1/authors', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Failed to delete authors')
  return res.json()
}

export async function fetchAuthorInsights(params: AuthorInsightsParams): Promise<AuthorInsights> {
  const query = toQuery({
    libraryId: params.libraryId ?? undefined,
    windowDays: params.windowDays ?? undefined,
    limit: params.limit ?? undefined,
  })
  const res = await api(`/api/v1/authors/insights${query}`)
  if (!res.ok) throw new Error('Failed to load author insights')
  return res.json()
}

export async function fetchDuplicateAuthorSuggestions(params: DuplicateSuggestionsParams): Promise<AuthorDuplicateSuggestion[]> {
  const query = toQuery({
    libraryId: params.libraryId ?? undefined,
    limit: params.limit ?? undefined,
    poolSize: params.poolSize ?? undefined,
    minConfidence: params.minConfidence ?? undefined,
  })
  const res = await api(`/api/v1/authors/suggestions/duplicates${query}`)
  if (!res.ok) throw new Error('Failed to load duplicate suggestions')
  return res.json()
}

export async function fetchAuthorMetadataCandidates(params: AuthorMetadataSearchParams): Promise<AuthorMetadataCandidate[]> {
  const query = toQuery({
    q: params.q,
    region: params.region ?? undefined,
    limit: params.limit ?? undefined,
    providers: params.providers ?? undefined,
  })

  const res = await api(`/api/v1/authors/metadata/search${query}`)
  if (!res.ok) throw new Error('Failed to load author metadata')
  return res.json()
}

export async function streamAuthorMetadataCandidates(
  params: AuthorMetadataSearchParams,
  onCandidate: (candidate: AuthorMetadataCandidate) => void,
  signal?: AbortSignal,
): Promise<void> {
  const query = toQuery({
    q: params.q,
    region: params.region ?? undefined,
    limit: params.limit ?? undefined,
    providers: params.providers ?? undefined,
  })

  const res = await api(`/api/v1/authors/metadata/stream${query}`, { signal })
  if (!res.ok || !res.body) throw new Error('Failed to stream author metadata')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''

    for (const event of events) {
      const line = event.split('\n').find((entry) => entry.startsWith('data:'))
      if (!line) continue
      try {
        onCandidate(JSON.parse(line.slice(5).trim()) as AuthorMetadataCandidate)
      } catch {
        // Ignore malformed SSE payloads
      }
    }
  }
}

export async function bulkRefreshAuthorsMetadata(
  authorIds: number[],
  onProgress?: (event: BulkAuthorMetadataRefreshEvent) => void,
): Promise<BulkAuthorMetadataRefreshResult> {
  if (authorIds.length === 0) {
    return { processed: 0, failed: 0, updated: 0 }
  }

  const res = await api('/api/v1/authors/bulk-refresh-metadata', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authorIds }),
  })
  if (!res.ok || !res.body) throw new Error('Failed to refresh author metadata')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let summary: BulkAuthorMetadataRefreshResult = { processed: 0, failed: 0, updated: 0 }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    for (const line of decoder.decode(value, { stream: true }).split('\n')) {
      if (!line.startsWith('data: ')) continue
      try {
        const payload = JSON.parse(line.slice(6)) as
          | (BulkAuthorMetadataRefreshEvent & { done?: false })
          | (BulkAuthorMetadataRefreshResult & { done: true })

        if ('done' in payload && payload.done) {
          summary = {
            processed: payload.processed,
            failed: payload.failed,
            updated: payload.updated,
          }
          continue
        }

        onProgress?.({
          authorId: payload.authorId,
          updated: payload.updated,
          imageUpdated: payload.imageUpdated,
          imageUrl: payload.imageUrl,
          error: payload.error,
        })
      } catch {
        // Ignore malformed SSE payloads
      }
    }
  }

  return summary
}

export async function refreshAuthorMetadata(authorId: number): Promise<AuthorDetail> {
  const res = await api(`/api/v1/authors/${authorId}/enrichment/refresh`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error('Failed to refresh author metadata')
  return res.json()
}
