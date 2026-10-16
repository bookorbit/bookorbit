import type { BookCard } from '@bookorbit/types'

/**
 * The global book search sorts by title, so "king" opens on "Bad Bishop" because its narrator
 * matched. Within the page already loaded, titles that start with the query come first, then
 * titles containing it as a word, then any title match, then everything else, each in server order.
 */
export function rankBooks(books: readonly BookCard[], query: string): BookCard[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return [...books]

  function rank(book: BookCard): number {
    const title = (book.title ?? '').toLocaleLowerCase()
    if (title.startsWith(needle)) return 0
    if (title.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(needle))) return 1
    if (title.includes(needle)) return 2
    return 3
  }

  return books
    .map((book, index) => ({ book, index, rank: rank(book) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.book)
}
