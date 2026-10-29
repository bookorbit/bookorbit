import type { BookDetail } from '@bookorbit/types'

/**
 * The stage is as tall as the portrait cover and as wide as the column, so the front cover keeps most
 * of its width and only a strip of the one behind shows. It never changes between the two states, so
 * swapping covers does not move the page.
 */
export const COVER_STACK_ASPECT_RATIO = '1 / 1.29'

/** Both slots hold art, so there is a second cover to put behind the first. */
export function hasCoverPair(book: Pick<BookDetail, 'covers'>): boolean {
  return book.covers.ebook !== null && book.covers.audio !== null
}
