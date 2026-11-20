import { api } from '@/lib/api'
import {
  taxonomyRouteSegment,
  type TaxonomyDetail,
  type TaxonomyIndexSort,
  type TaxonomyKind,
  type TaxonomyPage,
  type TaxonomySimilarResponse,
} from '@bookorbit/types'

export type SortDirection = 'asc' | 'desc'

export type ListTaxonomyParams = {
  q?: string
  page: number
  size: number
  sort: TaxonomyIndexSort
  order: SortDirection
  libraryId?: number | null
}

/** A failed request, carrying the status so a page can tell a missing name from an outage. */
export class TaxonomyRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

function toQuery(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(([, value]) => value != null && value !== '')
  return new URLSearchParams(entries.map(([key, value]) => [key, String(value)])).toString()
}

async function read<T>(path: string, failure: string): Promise<T> {
  const res = await api(path)
  if (!res.ok) throw new TaxonomyRequestError(`${failure}: ${res.status}`, res.status)
  return res.json() as Promise<T>
}

export function fetchTaxonomyPage(kind: TaxonomyKind, params: ListTaxonomyParams): Promise<TaxonomyPage> {
  return read(`/api/v1/${taxonomyRouteSegment(kind)}?${toQuery(params)}`, `Failed to fetch ${kind}s`)
}

export function fetchTaxonomyDetail(kind: TaxonomyKind, id: number): Promise<TaxonomyDetail> {
  return read(`/api/v1/${taxonomyRouteSegment(kind)}/${id}`, `Failed to fetch ${kind}`)
}

export function fetchSimilarTaxonomy(kind: TaxonomyKind, id: number): Promise<TaxonomySimilarResponse> {
  return read(`/api/v1/${taxonomyRouteSegment(kind)}/${id}/similar`, `Failed to fetch similar ${kind}s`)
}
