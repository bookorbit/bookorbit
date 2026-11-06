import {
  getBookMediaKind,
  isContentBookFile,
  type BookCard,
  type ConcreteBookMediaKind,
  type CoverAspectRatio,
  type CoverMedium,
} from '@bookorbit/types'

export type CardMediaView = {
  kind: ConcreteBookMediaKind
  coverAspectRatio: CoverAspectRatio
  /** The cover slot to ask for by name, or undefined when the book's default face is already that slot. */
  coverMedium: CoverMedium | undefined
}

/**
 * How a card looks in a grid that shows one medium, such as a series' Audiobooks group: the cover,
 * frame, format badge and action of that medium rather than of the book's primary file. Null when
 * the book has no file of that kind, so it keeps its own face.
 */
export function cardMediaView(
  book: Pick<BookCard, 'files' | 'coverAspectRatio'>,
  kind: ConcreteBookMediaKind | null | undefined,
): CardMediaView | null {
  if (!kind) return null
  if (!book.files.some((file) => isContentBookFile(file) && getBookMediaKind(file.format) === kind)) return null
  const medium: CoverMedium = kind === 'audiobook' ? 'audio' : 'ebook'
  const coverAspectRatio: CoverAspectRatio = medium === 'audio' ? '1/1' : '2/3'
  // The server frames a book by the slot its default face serves, so a matching frame means the
  // default URL already shows this medium; reusing it keeps the thumbnail other views have cached.
  return { kind, coverAspectRatio, coverMedium: coverAspectRatio === book.coverAspectRatio ? undefined : medium }
}
