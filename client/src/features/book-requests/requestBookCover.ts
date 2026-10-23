import type { BookRequestItem, CoverMedium } from '@bookorbit/types'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'

/**
 * The library's own cover for a request, tried after the request's art is missing or fails.
 *
 * A format asked for from a book's page carries no art of its own, and must not borrow the book's:
 * filing copies the request's art into the new format's cover slot. The book it joins, or the one
 * it became, still shows which book this is. The medium is a preference, so a book that has no
 * slot for it yet answers with the cover it does have.
 */
export function requestBookCoverSources(request: Pick<BookRequestItem, 'mediaKind' | 'matchedBookId' | 'targetBookId'>): string[] {
  const bookId = request.matchedBookId ?? request.targetBookId
  if (bookId === null) return []
  const medium: CoverMedium = request.mediaKind === 'audiobook' ? 'audio' : 'ebook'
  return [useCoverVersions().coverUrl(bookId, 'thumbnail', undefined, medium)]
}
