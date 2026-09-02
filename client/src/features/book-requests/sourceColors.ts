import { INDEXER_COLORS, type IndexerColor } from '@bookorbit/types'

/**
 * Written out rather than built from the slug, because Tailwind reads these files as text: a class
 * assembled at runtime is a class that was never generated. Every string here is a literal for
 * that reason, and the token behind it is tuned per theme in `assets/theme/tokens.css`.
 */
const CHIP_CLASSES: Record<IndexerColor, string> = {
  blue: 'border-[var(--pill-source-blue)]/40 bg-[var(--pill-source-blue)]/10 text-[var(--pill-source-blue)]',
  indigo: 'border-[var(--pill-source-indigo)]/40 bg-[var(--pill-source-indigo)]/10 text-[var(--pill-source-indigo)]',
  purple: 'border-[var(--pill-source-purple)]/40 bg-[var(--pill-source-purple)]/10 text-[var(--pill-source-purple)]',
  pink: 'border-[var(--pill-source-pink)]/40 bg-[var(--pill-source-pink)]/10 text-[var(--pill-source-pink)]',
  red: 'border-[var(--pill-source-red)]/40 bg-[var(--pill-source-red)]/10 text-[var(--pill-source-red)]',
  orange: 'border-[var(--pill-source-orange)]/40 bg-[var(--pill-source-orange)]/10 text-[var(--pill-source-orange)]',
  yellow: 'border-[var(--pill-source-yellow)]/40 bg-[var(--pill-source-yellow)]/10 text-[var(--pill-source-yellow)]',
  lime: 'border-[var(--pill-source-lime)]/40 bg-[var(--pill-source-lime)]/10 text-[var(--pill-source-lime)]',
  green: 'border-[var(--pill-source-green)]/40 bg-[var(--pill-source-green)]/10 text-[var(--pill-source-green)]',
  teal: 'border-[var(--pill-source-teal)]/40 bg-[var(--pill-source-teal)]/10 text-[var(--pill-source-teal)]',
}

const DOT_CLASSES: Record<IndexerColor, string> = {
  blue: 'bg-[var(--pill-source-blue)]',
  indigo: 'bg-[var(--pill-source-indigo)]',
  purple: 'bg-[var(--pill-source-purple)]',
  pink: 'bg-[var(--pill-source-pink)]',
  red: 'bg-[var(--pill-source-red)]',
  orange: 'bg-[var(--pill-source-orange)]',
  yellow: 'bg-[var(--pill-source-yellow)]',
  lime: 'bg-[var(--pill-source-lime)]',
  green: 'bg-[var(--pill-source-green)]',
  teal: 'bg-[var(--pill-source-teal)]',
}

/**
 * Protocol is not the operator's to assign: whether a grab joins a swarm or pulls a file decides
 * what happens next, and it reads the same on every install.
 */
const PROTOCOL_CLASSES = {
  torrent: 'border-[var(--pill-torrent)]/40 bg-[var(--pill-torrent)]/10 text-[var(--pill-torrent)]',
  direct: 'border-[var(--pill-direct)]/40 bg-[var(--pill-direct)]/10 text-[var(--pill-direct)]',
} as const

/** What an uncoloured source wears, which is what every source wore before colours existed. */
const NEUTRAL_CHIP = 'border-border text-muted-foreground'

/** A value straight off the wire: a row written by a newer build can name a hue this one lacks. */
export function isIndexerColor(value: unknown): value is IndexerColor {
  return typeof value === 'string' && (INDEXER_COLORS as readonly string[]).includes(value)
}

export function sourceChipClass(color: IndexerColor | null | undefined): string {
  return isIndexerColor(color) ? CHIP_CLASSES[color] : NEUTRAL_CHIP
}

export function sourceDotClass(color: IndexerColor | null | undefined): string {
  return isIndexerColor(color) ? DOT_CLASSES[color] : 'bg-muted-foreground/40'
}

export function protocolChipClass(seedsBack: boolean): string {
  return seedsBack ? PROTOCOL_CLASSES.torrent : PROTOCOL_CLASSES.direct
}
