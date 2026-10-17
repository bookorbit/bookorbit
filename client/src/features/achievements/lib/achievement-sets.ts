/** What each tier set counts. The server sends tiers, not a set name, so the set's label and unit live here. */
export type TierUnit = 'books' | 'pages' | 'hours' | 'annotations' | 'ratings' | 'genres' | 'languages' | 'days'

export interface TierSet {
  /** Message key under `achievements.sets`. */
  label: string
  unit: TierUnit
}

const TIER_SETS: Record<string, TierSet> = {
  books_finished: { label: 'booksFinished', unit: 'books' },
  pages_read: { label: 'pagesRead', unit: 'pages' },
  hours_read: { label: 'hoursRead', unit: 'hours' },
  long_book: { label: 'longestBook', unit: 'pages' },
  library_builder: { label: 'librarySize', unit: 'books' },
  annotator: { label: 'annotations', unit: 'annotations' },
  critic: { label: 'booksRated', unit: 'ratings' },
  genre_explorer: { label: 'genresFinished', unit: 'genres' },
  polyglot: { label: 'languagesFinished', unit: 'languages' },
  streak: { label: 'readingStreak', unit: 'days' },
}

/** Null for a set this build does not know yet; callers fall back to unit-less wording. */
export function tierSetOf(groupKey: string | null | undefined): TierSet | null {
  if (!groupKey) return null
  return TIER_SETS[groupKey] ?? null
}
