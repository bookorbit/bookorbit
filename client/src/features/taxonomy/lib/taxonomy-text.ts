/** Folds a string the way the server's `bookorbit_unaccent` search does: no marks, lower case. */
function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** The letter a name files under in the index: A to Z after folding accents, otherwise `#`. */
export function letterOf(name: string): string {
  const first = fold(name.trimStart()).charAt(0).toUpperCase()
  return first >= 'A' && first <= 'Z' ? first : '#'
}

export type HighlightSegment = { text: string; match: boolean }

/**
 * Splits a name around the first place the query matches, ignoring case and accents, so the
 * matched span can be marked without changing the name as written.
 */
export function highlightSegments(name: string, query: string): HighlightSegment[] {
  const needle = fold(query.trim())
  if (!needle) return [{ text: name, match: false }]

  let folded = ''
  const origin: number[] = []
  let index = 0
  for (const char of name) {
    const piece = fold(char)
    for (let i = 0; i < piece.length; i++) origin.push(index)
    folded += piece
    index += char.length
  }
  origin.push(name.length)

  const at = folded.indexOf(needle)
  if (at < 0) return [{ text: name, match: false }]
  const start = origin[at]!
  const end = origin[at + needle.length]!
  return [
    { text: name.slice(0, start), match: false },
    { text: name.slice(start, end), match: true },
    { text: name.slice(end), match: false },
  ].filter((segment) => segment.text.length > 0)
}

export type LetterGroup<T> = { key: string; label: string | null; items: T[] }

/** Groups name-sorted items under their letter; anything else stays one unlabelled group. */
export function groupByLetter<T extends { name: string }>(items: T[], grouped: boolean): LetterGroup<T>[] {
  if (!grouped) return items.length ? [{ key: 'all', label: null, items }] : []
  const groups: LetterGroup<T>[] = []
  for (const item of items) {
    const letter = letterOf(item.name)
    const last = groups[groups.length - 1]
    if (last?.label === letter) last.items.push(item)
    else groups.push({ key: `${letter}:${groups.length}`, label: letter, items: [item] })
  }
  return groups
}

/** The index and page route names for a kind. */
export function taxonomyRouteNames(kind: 'genre' | 'tag'): { index: 'genres' | 'tags'; detail: 'genre-detail' | 'tag-detail' } {
  return kind === 'genre' ? { index: 'genres', detail: 'genre-detail' } : { index: 'tags', detail: 'tag-detail' }
}

export type TaxonomyViewMode = 'list' | 'cloud'
