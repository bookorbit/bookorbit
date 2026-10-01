import { getBookMediaProfile, type BookCard } from '@bookorbit/types'

export const SERIES_BOOK_MEDIA_GROUP_DEFS = [
  { key: 'books', label: 'Books' },
  { key: 'audiobooks', label: 'Audiobooks' },
  { key: 'comics', label: 'Comics' },
] as const

export type SeriesBookMediaGroupKey = (typeof SERIES_BOOK_MEDIA_GROUP_DEFS)[number]['key']

export type SeriesBookMediaGroup = {
  key: SeriesBookMediaGroupKey
  label: string
  books: BookCard[]
}

export function getSeriesBookMediaGroupKeys(book: BookCard): SeriesBookMediaGroupKey[] {
  const profile = getBookMediaProfile(book.files)
  const keys: SeriesBookMediaGroupKey[] = []

  if (profile.hasEbook) keys.push('books')
  if (profile.hasAudio) keys.push('audiobooks')
  if (profile.hasComic) keys.push('comics')

  return keys.length > 0 ? keys : ['books']
}

export function groupSeriesBooksByMedia(books: BookCard[]): SeriesBookMediaGroup[] {
  const grouped = new Map<SeriesBookMediaGroupKey, BookCard[]>(SERIES_BOOK_MEDIA_GROUP_DEFS.map((group) => [group.key, []]))

  for (const book of books) {
    for (const key of getSeriesBookMediaGroupKeys(book)) {
      grouped.get(key)?.push(book)
    }
  }

  return SERIES_BOOK_MEDIA_GROUP_DEFS.map((group) => ({
    ...group,
    books: grouped.get(group.key) ?? [],
  }))
}
