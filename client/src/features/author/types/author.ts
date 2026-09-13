import type { AuthorDetail, AuthorSummary } from '@bookorbit/types'

export type SortDirection = 'asc' | 'desc'
export type AuthorListSort = 'name' | 'sortName' | 'bookCount' | 'lastAddedAt' | 'lastEnrichedAt'
export type AuthorBookSort = 'title' | 'publishedYear' | 'addedAt'

export type LibraryFilterOption = {
  id: number
  name: string
}

/** The quick filters offered as chips. Mutually exclusive; the library filter is separate. */
export type AuthorQuickFilter = 'all' | 'noPortrait' | 'multipleBooks' | 'recentlyAdded' | 'noSortName'

export type AuthorQuickFilterCounts = Record<AuthorQuickFilter, number>

/** Window used by the "recently added" chip, shared by the client and the query it sends. */
export const RECENTLY_ADDED_DAYS = 7

export type { AuthorSummary, AuthorDetail }
