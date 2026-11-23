import { editionLabel, editionLabels, sortEditions, type BookCard, type BookDetail, type LinkedBookSummary } from '@bookorbit/types'
import { getBookMediaKind } from '@bookorbit/types'

/** One edition of the work a book page belongs to, ready to draw. */
export interface EditionEntry {
  summary: LinkedBookSummary
  label: string
  current: boolean
}

/**
 * This book as its own edition summary. Servers with `book-editions` send it as `linkSelf`; the
 * fallback builds it from the detail so the strip still names the current edition.
 */
export function selfEditionSummary(book: BookDetail): LinkedBookSummary {
  if (book.linkSelf) return book.linkSelf
  const formats = [...new Set(book.files.filter((file) => file.role === 'content' && file.format).map((file) => file.format!.toLowerCase()))]
  return {
    bookId: book.id,
    libraryId: book.libraryId,
    libraryName: book.libraryName,
    title: book.title,
    formats,
    mediaKind: getBookMediaKind(formats[0]),
    status: book.status,
    isLead: book.linkIsLead ?? false,
    editionName: book.editionName ?? null,
    publisher: book.publisher,
    publishedYear: book.publishedYear,
    originalPublishedYear: book.originalPublishedYear ?? null,
    narrators: (book.audioMetadata?.narrators ?? []).map((narrator) => narrator.name),
  }
}

/** Every edition the viewer can see, the current one included, in the shared order and with their labels. */
export function bookEditions(book: BookDetail): EditionEntry[] {
  const others = book.linkedBooks ?? []
  if (others.length === 0) return []
  const all = sortEditions([selfEditionSummary(book), ...others])
  const labels = editionLabels(all)
  return all.map((summary) => ({ summary, label: labels.get(summary.bookId) ?? summary.libraryName, current: summary.bookId === book.id }))
}

/** What the delete prompt says about a book's other editions. */
export interface DeleteEditionsChoice {
  current: { label: string; formats: string[]; libraryName: string }
  /** Other editions this user may delete, in the shared order. */
  others: Array<{ bookId: number; label: string; libraryName: string }>
  /** Other editions in libraries this user cannot delete from: they stay whatever is chosen. */
  kept: number
}

export function deleteEditionsChoice(book: BookDetail, canDelete: (libraryId: number) => boolean): DeleteEditionsChoice | null {
  const editions = bookEditions(book)
  const current = editions.find((entry) => entry.current)
  if (!current) return null
  const others = editions.filter((entry) => !entry.current)
  const deletable = others.filter((entry) => canDelete(entry.summary.libraryId))
  return {
    current: { label: current.label, formats: current.summary.formats, libraryName: current.summary.libraryName },
    others: deletable.map((entry) => ({ bookId: entry.summary.bookId, label: entry.label, libraryName: entry.summary.libraryName })),
    kept: others.length - deletable.length,
  }
}

/**
 * What tells this card's edition apart from others of the same title: its edition name, else the
 * narrator of an audiobook, else publisher and year. Null when the card has none, so a row adds nothing.
 */
export function cardEditionDetail(card: Pick<BookCard, 'id' | 'files' | 'narrators' | 'publisher' | 'publishedYear' | 'editionName'>): string | null {
  const formats = card.files.flatMap((file) => (file.format ? [file.format.toLowerCase()] : []))
  const label = editionLabel({
    bookId: card.id,
    libraryName: '',
    formats,
    editionName: card.editionName,
    narrators: card.narrators,
    publisher: card.publisher,
    publishedYear: card.publishedYear,
  })
  return label || null
}

/** Every book a grouping request ends up holding: the requested ones and every group they bring along. */
export function groupingResultIds(requestedIds: Iterable<number>, cards: ReadonlyArray<Pick<BookCard, 'id' | 'linked'>>): Set<number> {
  const ids = new Set(requestedIds)
  for (const card of cards) {
    if (!ids.has(card.id)) continue
    for (const member of card.linked?.books ?? []) ids.add(member.bookId)
  }
  return ids
}

/** A card stands for a work with other editions this viewer can see. */
export function cardEditionCount(card: Pick<BookCard, 'linked' | 'collapsedSeries'>): number {
  if (card.collapsedSeries) return 0
  const count = card.linked?.memberCount ?? 0
  return count > 1 ? count : 0
}
