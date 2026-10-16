import { hash, rng, type ParsedBook, type PlaceholderInput, type Random } from './typeset'

export type GenreFamilyKey = 'horror' | 'romance' | 'fantasy' | 'scifi' | 'mystery' | 'classic' | 'nonfiction' | 'young'

// Genre only drives the Paperback bands, whose whole idea is colour-coding by genre. Everything else
// keys on series, author and title: genres are missing on many books, arrive later than the book
// does, and cluster, so a cover built from them would change colour once metadata is fetched.
const FAMILIES: readonly { key: GenreFamilyKey; match: RegExp }[] = [
  { key: 'horror', match: /horror|paranormal|ghost|haunt|gothic|vampire|zombie|occult|supernatural/i },
  { key: 'romance', match: /romance|romantic|rom ?com|love stor/i },
  { key: 'fantasy', match: /fantasy|magic|dragon|fairy|myth|witch|sword|sorcer/i },
  { key: 'scifi', match: /science fiction|sci-?fi|space opera|dystop|cyberpunk|time travel/i },
  { key: 'mystery', match: /myster|thriller|suspense|crime|detective|noir|police|murder|espionage/i },
  { key: 'classic', match: /classic|historical|history|\bwar\b/i },
  {
    key: 'nonfiction',
    match:
      /non-?fiction|business|econom|psycholog|philosoph|self-help|memoir|biograph|computer|programming|technology|internet|social science|health|relig|essay|artificial intelligence/i,
  },
  { key: 'young', match: /young adult|middle grade|child|juvenile|kids|teen/i },
]

const GENERIC = /^(fiction|books|audiobooks?|general|adult|novels?|fiction & literature|literature & fiction|book club|contemporary)$/i

export function familyOf(genres: readonly string[] | null | undefined): GenreFamilyKey | null {
  for (const genre of genres ?? []) {
    if (GENERIC.test(genre.trim())) continue
    const family = FAMILIES.find((f) => f.match.test(genre))
    if (family) return family.key
  }
  return null
}

export interface Palette {
  /** Shared by a series, else by an author's books, else by the title alone. */
  group: number
  /** Unique to the book. */
  item: number
  /** Seeded by the group: colour scheme and ground, so a series or an author's books read as a set. */
  s: Random
  /** Seeded by the book: composition, so books in one set still differ. */
  r: Random
  family: GenreFamilyKey | null
}

const groupKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

export function paletteFor(input: PlaceholderInput, p: ParsedBook): Palette {
  const rawSeries = input.seriesName?.trim() ?? ''
  const series = groupKey(rawSeries && !/^\d+$/.test(rawSeries) ? rawSeries : (p.series?.name ?? ''))
  const author = groupKey(p.authors[0] ?? p.credit ?? '')
  const title = groupKey(p.main)
  const group = hash(series ? `series:${series}` : author ? `author:${author}` : `title:${title || input.seed}`)
  const item = hash(`${title}|${p.volume ?? p.series?.index ?? ''}|${input.seed}`)
  return { group, item, s: rng(group), r: rng(item), family: familyOf(input.genres) }
}

/** The group's entry in a style's hand-picked list. */
export function schemeFor<T>(pal: Palette, schemes: readonly T[]): T {
  return schemes[pal.group % schemes.length] as T
}

/** A fixed mix such as 40% paper, 35% ink, 25% colour, drawn with the group's generator. */
export function weighted<T>(r: Random, choices: readonly (readonly [T, number])[]): T {
  const total = choices.reduce((sum, [, weight]) => sum + weight, 0)
  let roll = r() * total
  for (const [value, weight] of choices) {
    roll -= weight
    if (roll < 0) return value
  }
  return (choices.at(-1) as readonly [T, number])[0]
}

export const hue = (h: number): number => ((Math.round(h) % 360) + 360) % 360

export const ok = (l: number, c: number, h: number): string => `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${hue(h)})`
