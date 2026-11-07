import { BOOK_LINK_MAX_MEMBERS, type BookCard, type BookCardLinkInfo, type BookMediaKind } from '@bookorbit/types'
import { i18n } from '@/i18n'

/** Why the selection bar offers Link but cannot run it. */
export type LinkDisabledReason = 'queryScoped' | 'tooFew' | 'tooMany' | 'notEditable'

export interface LinkSelectionState {
  disabledReason: LinkDisabledReason | null
}

/** A book handed to the Link sheet by name, for a host without a card for it (a blocked merge's books). */
export interface LinkSeedBook {
  id: number
  title: string
  libraryId: number
  /** Format codes such as `epub` or `m4b`. */
  formats: string[]
}

/**
 * Linking names each book, so a query selection cannot be linked; the server also needs editor
 * access to every selected book's library, which a mixed selection may not have.
 */
export function linkDisabledReason(options: { queryScoped: boolean; count: number; allEditable: boolean }): LinkDisabledReason | null {
  if (options.queryScoped) return 'queryScoped'
  if (options.count < 2) return 'tooFew'
  if (options.count > BOOK_LINK_MAX_MEMBERS) return 'tooMany'
  if (!options.allEditable) return 'notEditable'
  return null
}

/** The card stands for a book linked with others this viewer can see. */
export function hasLinkedBooks(card: Pick<BookCard, 'linked'> | null | undefined): boolean {
  return (card?.linked?.books.length ?? 0) > 0
}

export type CardFormatBadge = {
  /** A format key as `bookFormatEntries` names it, such as `epub`, `epub:readalong` or `m4b`. */
  key: string
  /** Comes from a linked book rather than the card's own files. */
  linked: boolean
  /** The linked book's library, for the badge's text alternative. Null for the card's own formats. */
  libraryId: number | null
}

/**
 * Every format a card can be read or heard in: its own editions in the order given, then formats
 * only its linked books add. A format the card already has is not repeated for a linked book, and
 * a multi-track audiobook counts once.
 */
export function cardFormatBadges(ownKeys: readonly string[], linked: BookCardLinkInfo | null | undefined): CardFormatBadge[] {
  const seen = new Set<string>()
  const badges: CardFormatBadge[] = []
  for (const key of ownKeys) {
    if (seen.has(key)) continue
    seen.add(key)
    badges.push({ key, linked: false, libraryId: null })
  }
  for (const book of linked?.books ?? []) {
    for (const format of book.formats) {
      const key = format.trim().toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      badges.push({ key, linked: true, libraryId: book.libraryId })
    }
  }
  return badges
}

/** "Audiobook", "Ebook": what a linked book is, in words. */
export function linkedMediumLabel(kind: BookMediaKind): string {
  switch (kind) {
    case 'audiobook':
      return i18n.global.t('book.link.medium.audiobook')
    case 'comic':
      return i18n.global.t('book.link.medium.comic')
    case 'ebook':
      return i18n.global.t('book.link.medium.ebook')
    default:
      return i18n.global.t('book.link.medium.unknown')
  }
}
