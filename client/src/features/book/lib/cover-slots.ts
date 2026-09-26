import type { BookDetail, BookMetadataLockField, CoverAspectRatio, CoverMedium, MetadataCandidate, MetadataCoverShape } from '@bookorbit/types'

type SlotBook = Pick<BookDetail, 'coverMedia' | 'covers' | 'coverSource' | 'coverVersion'>

export function otherMedium(medium: CoverMedium): CoverMedium {
  return medium === 'ebook' ? 'audio' : 'ebook'
}

export type CoverFit = 'match' | 'unknown' | 'mismatch'

const SLOT_SHAPE: Record<CoverMedium, Exclude<MetadataCoverShape, 'unknown'>> = { ebook: 'portrait', audio: 'square' }

/** Slot-shaped art ranks first and art of the other shape last, as in the server's cover choices. */
export const COVER_FIT_RANK: Record<CoverFit, number> = { match: 0, unknown: 1, mismatch: 2 }

export function coverFit(shape: MetadataCoverShape, medium: CoverMedium): CoverFit {
  if (shape === 'unknown') return 'unknown'
  return shape === SLOT_SHAPE[medium] ? 'match' : 'mismatch'
}

export function statedCoverShape(candidate: MetadataCandidate): MetadataCoverShape {
  return candidate.coverShape ?? 'unknown'
}

export function coverLockField(medium: CoverMedium | null): Extract<BookMetadataLockField, 'cover' | 'audioCover'> {
  return medium === 'audio' ? 'audioCover' : 'cover'
}

/** Mirrors the server's face rule: a square library shows the audio slot, any other shape the ebook slot. */
export function faceMedium(book: Pick<SlotBook, 'covers'>, aspectRatio: CoverAspectRatio | string): CoverMedium {
  const preferred: CoverMedium = aspectRatio === '1/1' ? 'audio' : 'ebook'
  if (book.covers[preferred]) return preferred
  const alternate = otherMedium(preferred)
  return book.covers[alternate] ? alternate : preferred
}

/**
 * The media the editor shows one tile each for. A book with no content files still gets one tile,
 * with no medium, so its writes fall through to the server's own routing.
 */
export function editorTiles(book: Pick<SlotBook, 'coverMedia'>): (CoverMedium | null)[] {
  const tiles = (['ebook', 'audio'] as const).filter((medium) => book.coverMedia.includes(medium))
  return tiles.length > 0 ? tiles : [null]
}

/** The slot a metadata result's `cover` field fills: the ebook slot, unless the book has no ebook. */
export function coverFieldMedium(book: Pick<SlotBook, 'coverMedia'>): CoverMedium | null {
  if (book.coverMedia.includes('ebook')) return 'ebook'
  if (book.coverMedia.includes('audio')) return 'audio'
  return null
}

/** A cover the upgrade has not moved into a slot yet: the summary says there is one, but no slot holds it. */
export function isLegacyCover(book: Pick<SlotBook, 'covers' | 'coverSource'>): boolean {
  return book.coverSource !== null && book.covers.ebook === null && book.covers.audio === null
}

export type CoverTileState = {
  hasImage: boolean
  source: 'extracted' | 'custom' | null
  version: string
}

/**
 * What a tile shows. Until the upgrade converts a legacy cover, it has no slot, so the tile the face
 * would resolve to shows it rather than an empty placeholder.
 */
export function coverTileState(book: SlotBook, medium: CoverMedium | null, aspectRatio: CoverAspectRatio | string): CoverTileState {
  const slot = medium ? book.covers[medium] : null
  if (slot) return { hasImage: true, source: slot.source, version: slot.updatedAt }
  if (!isLegacyCover(book)) return { hasImage: false, source: null, version: book.coverVersion }
  const tiles = editorTiles(book)
  const legacyTile = tiles.length === 1 ? tiles[0] : faceMedium(book, aspectRatio)
  if (medium !== legacyTile) return { hasImage: false, source: null, version: book.coverVersion }
  return { hasImage: true, source: book.coverSource, version: book.coverVersion }
}
