import {
  BOOK_REQUEST_LIST_VIEWS,
  BOOK_REQUEST_MEDIA_KINDS,
  BOOK_REQUEST_SEARCH_MAX_LENGTH,
  BOOK_REQUEST_SORT_FIELDS,
  BOOK_REQUEST_STATUSES,
} from '@bookorbit/types'
import type { BookRequestListView, BookRequestMediaKind, BookRequestSortDirection, BookRequestSortField, BookRequestStatus } from '@bookorbit/types'
import type { LocationQuery, LocationQueryRaw } from 'vue-router'

/** `all` is every request still on the viewer's list; the others are one section of it. */
export type RequestListView = 'all' | BookRequestListView
export const REQUEST_LIST_VIEWS: readonly RequestListView[] = ['all', ...BOOK_REQUEST_LIST_VIEWS]

/** Whether the request had to wait for someone to approve it, which is what self-serve skips. */
export type RequestApprovalFilter = '' | 'needed' | 'skipped'

/**
 * Everything that decides which rows the list shows, kept in the query string so a refresh, a
 * shared link and Back all land on the same list. The tab lives there too, but it belongs to the
 * page, not to the list.
 */
export interface RequestListState {
  view: RequestListView
  q: string
  status: BookRequestStatus | ''
  format: BookRequestMediaKind | ''
  requester: number | ''
  approval: RequestApprovalFilter
  sort: BookRequestSortField
  dir: BookRequestSortDirection
  page: number
}

export const LIST_QUERY_KEYS = ['view', 'q', 'status', 'format', 'requester', 'approval', 'sort', 'dir', 'page'] as const

export const DEFAULT_LIST_STATE: RequestListState = {
  view: 'all',
  q: '',
  status: '',
  format: '',
  requester: '',
  approval: '',
  sort: 'createdAt',
  dir: 'desc',
  page: 1,
}

/** A date reads newest first by default; every other column starts at A to Z. */
export function defaultSortDirection(field: BookRequestSortField): BookRequestSortDirection {
  return field === 'createdAt' ? 'desc' : 'asc'
}

function single(value: LocationQuery[string] | undefined): string {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' ? first : ''
}

function oneOf<T extends string>(value: string, allowed: readonly T[]): T | '' {
  return (allowed as readonly string[]).includes(value) ? (value as T) : ''
}

/** Anything unknown or malformed falls back to its default, so a stale link still opens a list. */
export function parseListQuery(query: LocationQuery, allowRequester: boolean): RequestListState {
  const view = oneOf(single(query.view), REQUEST_LIST_VIEWS) || DEFAULT_LIST_STATE.view
  const sort = oneOf(single(query.sort), BOOK_REQUEST_SORT_FIELDS) || DEFAULT_LIST_STATE.sort
  const dir = oneOf(single(query.dir), ['asc', 'desc'] as const) || defaultSortDirection(sort)
  const requester = Number(single(query.requester))
  const page = Number(single(query.page))
  return {
    view,
    q: single(query.q).trim().slice(0, BOOK_REQUEST_SEARCH_MAX_LENGTH),
    status: oneOf(single(query.status), BOOK_REQUEST_STATUSES),
    format: oneOf(single(query.format), BOOK_REQUEST_MEDIA_KINDS),
    requester: allowRequester && Number.isInteger(requester) && requester > 0 ? requester : '',
    approval: oneOf(single(query.approval), ['needed', 'skipped'] as const),
    sort,
    dir,
    page: Number.isInteger(page) && page > 1 ? page : 1,
  }
}

/** Only what differs from the defaults goes in the URL, so the plain list keeps a plain address. */
export function listStateToQuery(state: RequestListState): Record<string, string> {
  const query: Record<string, string> = {}
  if (state.view !== DEFAULT_LIST_STATE.view) query.view = state.view
  if (state.q) query.q = state.q
  if (state.status) query.status = state.status
  if (state.format) query.format = state.format
  if (state.requester !== '') query.requester = String(state.requester)
  if (state.approval) query.approval = state.approval
  if (state.sort !== DEFAULT_LIST_STATE.sort) query.sort = state.sort
  if (state.dir !== defaultSortDirection(state.sort)) query.dir = state.dir
  if (state.page > 1) query.page = String(state.page)
  return query
}

/** The query with the list's own keys taken out, which is what the rest of the page owns. */
export function withoutListQuery(query: LocationQuery): LocationQueryRaw {
  return Object.fromEntries(Object.entries(query).filter(([key]) => !(LIST_QUERY_KEYS as readonly string[]).includes(key)))
}

/** The filters that narrow the list, as opposed to the view, sort and page that arrange it. */
export function activeFilterCount(state: RequestListState): number {
  return [state.status, state.format, state.requester, state.approval].filter((value) => value !== '').length
}

export function listStateKey(state: RequestListState): string {
  return JSON.stringify(listStateToQuery(state))
}
