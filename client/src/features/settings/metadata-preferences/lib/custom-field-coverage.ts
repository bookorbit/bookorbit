import type { CustomMetadataFieldDefinition, Library } from '@bookorbit/types'

type CoverageLibrary = Pick<Library, 'id' | 'bookCount'>
type CoverageField = Pick<CustomMetadataFieldDefinition, 'enabledLibraryIds' | 'usageByLibrary'>

export interface FieldCoverage {
  /** Books in the libraries the field is on. */
  books: number
  /** Of those, books with a value. */
  filled: number
  /** Values kept in libraries the field is off for. They return when the library is turned back on. */
  hidden: number
  all: boolean
  none: boolean
}

function usageIn(field: CoverageField, libraryId: number): number {
  return field.usageByLibrary?.[libraryId] ?? 0
}

export function fieldCoverage(field: CoverageField, libraries: CoverageLibrary[], libraryIds: number[] = field.enabledLibraryIds): FieldCoverage {
  const on = new Set(libraryIds)
  let books = 0
  let filled = 0
  for (const library of libraries) {
    if (!on.has(library.id)) continue
    books += library.bookCount ?? 0
    filled += usageIn(field, library.id)
  }
  let hidden = 0
  for (const [id, count] of Object.entries(field.usageByLibrary ?? {})) {
    if (!on.has(Number(id))) hidden += count
  }
  return { books, filled, hidden, all: libraries.length > 0 && libraries.every((library) => on.has(library.id)), none: on.size === 0 }
}

/** Libraries that hold values but would be off if `libraryIds` were saved, with how many values each keeps. */
export function librariesHidingValues<T extends CoverageLibrary>(
  field: CoverageField,
  libraries: T[],
  libraryIds: number[],
): Array<{ library: T; count: number }> {
  const on = new Set(libraryIds)
  return libraries
    .filter((library) => !on.has(library.id) && usageIn(field, library.id) > 0)
    .map((library) => ({ library, count: usageIn(field, library.id) }))
}

/** The server's key for a new label (`slugifyLabel` plus its collision suffix), so the sheet can show it before saving. */
export function previewFieldKey(label: string, takenKeys: Iterable<string>): string {
  const base =
    label
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 100) || 'custom_field'
  const taken = new Set(takenKeys)
  if (!taken.has(base)) return base
  for (let suffix = 1; suffix < 1000; suffix++) {
    const key = `${base.slice(0, Math.max(1, 97 - String(suffix).length))}_${suffix}`
    if (!taken.has(key)) return key
  }
  return base
}

export function sameLibraries(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}
