import type { AuthorDetail, AuthorSummary } from '@projectx/types'

export type SortDirection = 'asc' | 'desc'
export type AuthorListSort = 'name' | 'bookCount' | 'lastAddedAt'
export type AuthorBookSort = 'title' | 'publishedYear' | 'addedAt'

export type LibraryFilterOption = {
  id: number
  name: string
}

export type { AuthorSummary, AuthorDetail }
