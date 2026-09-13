import type { ReleaseCandidateItem } from '@bookorbit/types'

import { formatLanguageName } from '@/i18n/formatters'

/**
 * How the release picker groups a list into filter chips. Kept out of the panel so the rules can
 * be tested against the code that actually ships rather than against a copy of it.
 */

/**
 * Indexers spell the same language differently: MyAnonaMouse says "ENG" where Project Gutenberg
 * says "en". Both render as "English", so faceting on the raw code produced two chips that looked
 * identical and each hid the other's releases. Facets and filtering both key on the resolved name.
 */
export function languageKey(code: string | null): string | null {
  if (!code) return null
  return formatLanguageName(code.toLowerCase())
}

/** Same collision, one letter case apart: "epub" and "EPUB" are one format, not two. */
export function formatKey(value: string | null): string | null {
  return value ? value.toUpperCase() : null
}

/** Every format the release claims, in the order the server put them: preferred ones first. */
export function formatKeys(release: ReleaseCandidateItem): string[] {
  return release.formats.map((value) => value.toUpperCase())
}

export interface ReleaseFacet {
  value: string
  count: number
}

/**
 * Counted against every other active filter, so a chip never offers a combination with no rows.
 *
 * A reader may return several values, and the release then counts under each of them: one book
 * published as an epub, a mobi and an azw3 belongs under all three chips, and counting it under
 * only the first is what hid it from a filter on a format it actually carries.
 */
export function facetsOf<T>(list: T[], read: (item: T) => string | string[] | null): ReleaseFacet[] {
  const counts = new Map<string, number>()
  for (const item of list) {
    const value = read(item)
    const values = value === null ? [] : Array.isArray(value) ? value : [value]
    for (const one of new Set(values)) counts.set(one, (counts.get(one) ?? 0) + 1)
  }
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}
