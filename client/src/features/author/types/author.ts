import type { AuthorDetail, AuthorSummary } from '@bookorbit/types'

export type SortDirection = 'asc' | 'desc'
export type AuthorListSort = 'name' | 'sortName' | 'bookCount' | 'lastAddedAt' | 'lastEnrichedAt'
export type AuthorBookSort = 'title' | 'publishedYear' | 'addedAt'

export type LibraryFilterOption = {
  id: number
  name: string
}

export type { AuthorSummary, AuthorDetail }
