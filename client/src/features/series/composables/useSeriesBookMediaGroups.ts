import { isAudioFormat, type BookCard } from '@bookorbit/types'

const COMIC_FORMATS = new Set(['cbz', 'cbr', 'cb7'])

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

export function getSeriesBookMediaGroupKey(book: BookCard): SeriesBookMediaGroupKey {
  const file = book.files.find((candidate) => candidate.role === 'primary') ?? book.files.find((candidate) => candidate.format) ?? null
  const format = file?.format?.trim().toLowerCase()

  if (!format) return 'books'
  if (isAudioFormat(format)) return 'audiobooks'
  if (COMIC_FORMATS.has(format)) return 'comics'
  return 'books'
}

export function groupSeriesBooksByMedia(books: BookCard[]): SeriesBookMediaGroup[] {
  const grouped = new Map<SeriesBookMediaGroupKey, BookCard[]>(SERIES_BOOK_MEDIA_GROUP_DEFS.map((group) => [group.key, []]))

  for (const book of books) {
    grouped.get(getSeriesBookMediaGroupKey(book))?.push(book)
  }

  return SERIES_BOOK_MEDIA_GROUP_DEFS.map((group) => ({
    ...group,
    books: grouped.get(group.key) ?? [],
  }))
}
