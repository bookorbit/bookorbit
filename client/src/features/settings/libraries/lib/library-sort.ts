import type { Library, LibraryOverviewEntry } from '@bookorbit/types'

export const LIBRARY_SORT_FIELDS = ['default', 'name', 'books', 'size', 'lastScan'] as const
export type LibrarySortField = (typeof LIBRARY_SORT_FIELDS)[number]

export function isLibrarySortField(value: string): value is LibrarySortField {
  return (LIBRARY_SORT_FIELDS as readonly string[]).includes(value)
}

/** Matches on the library name and on every configured folder path, so pasting a path finds its library. */
export function matchesLibraryQuery(library: Library, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  if (library.name.toLowerCase().includes(needle)) return true
  return library.folders.some((folder) => folder.path.toLowerCase().includes(needle))
}

function lastScanTime(entry: LibraryOverviewEntry | undefined): number {
  if (!entry?.lastScan) return Number.NEGATIVE_INFINITY
  return new Date(entry.lastScan.startedAt).getTime()
}

export function sortLibraries(
  libraries: Library[],
  field: LibrarySortField,
  overview: Map<number, LibraryOverviewEntry>,
  collator: Intl.Collator,
): Library[] {
  if (field === 'default') return libraries
  const sorted = [...libraries]
  sorted.sort((a, b) => {
    switch (field) {
      case 'name':
        return collator.compare(a.name, b.name)
      case 'books':
        return (overview.get(b.id)?.totalBooks ?? 0) - (overview.get(a.id)?.totalBooks ?? 0)
      case 'size':
        return (overview.get(b.id)?.totalSizeBytes ?? 0) - (overview.get(a.id)?.totalSizeBytes ?? 0)
      case 'lastScan':
        return lastScanTime(overview.get(b.id)) - lastScanTime(overview.get(a.id))
    }
  })
  return sorted
}
