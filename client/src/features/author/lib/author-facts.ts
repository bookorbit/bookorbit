import type { AuthorDetail } from '@bookorbit/types'
import { formatDate, formatNumber } from '@/i18n/formatters'

/** What the edit panel holds for the facts, as typed: a life date is a year or a full date. */
export type AuthorFactsDraft = {
  website: string
  born: string
  died: string
  genres: string[]
  influences: string[]
}

export type AuthorFactsPayload = {
  website?: string | null
  birthDate?: string | null
  birthYear?: number | null
  deathDate?: string | null
  deathYear?: number | null
  genres?: string[] | null
  influences?: string[] | null
}

export type AuthorFactsField = 'website' | 'born' | 'died'

type LifeDate = { date: string | null; year: number | null }

const YEAR_INPUT = /^-?\d{1,4}$/
const DATE_INPUT = /^\d{4}-\d{2}-\d{2}$/
const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i

export function authorFactsDraft(author: AuthorDetail | null): AuthorFactsDraft {
  return {
    website: author?.website ?? '',
    born: lifeDateInput(author?.birthDate ?? null, author?.birthYear ?? null),
    died: lifeDateInput(author?.deathDate ?? null, author?.deathYear ?? null),
    genres: [...(author?.genres ?? [])],
    influences: [...(author?.influences ?? [])],
  }
}

function lifeDateInput(date: string | null, year: number | null): string {
  if (date) return date
  return year !== null ? String(year) : ''
}

/** Null when the text is neither a year nor a real yyyy-mm-dd date. */
export function parseLifeDateInput(value: string): LifeDate | null {
  const trimmed = value.trim()
  if (!trimmed) return { date: null, year: null }
  if (YEAR_INPUT.test(trimmed)) return { date: null, year: Number(trimmed) }
  if (!DATE_INPUT.test(trimmed)) return null

  const [year, month, day] = trimmed.split('-').map(Number) as [number, number, number]
  if (year < 1) return null
  // setUTCFullYear, because Date.UTC reads years below 100 as 19xx.
  const parsed = new Date(0)
  parsed.setUTCFullYear(year, month - 1, day)
  const real = parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
  return real ? { date: trimmed, year } : null
}

/** Adds https:// to a bare host. Null clears the website; undefined means it is not an http(s) link with a dotted host. */
export function normalizeWebsiteInput(value: string): string | null | undefined {
  const trimmed = value.trim()
  if (!trimmed) return null
  const candidate = URL_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(candidate)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname.includes('.')) return undefined
    return candidate
  } catch {
    return undefined
  }
}

/** Only http(s) links are rendered as links; anything else a provider sent stays plain text. */
export function isSafeWebsite(value: string | null | undefined): value is string {
  return !!value && /^https?:\/\//i.test(value.trim())
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

/**
 * Only the facts the user changed are sent. A value the server never validated (a provider's
 * website without a dotted host, say) would otherwise fail every save of an unrelated field.
 */
export function authorFactsPayload(draft: AuthorFactsDraft, seeded: AuthorFactsDraft): { payload: AuthorFactsPayload; invalid: AuthorFactsField[] } {
  const payload: AuthorFactsPayload = {}
  const invalid: AuthorFactsField[] = []

  if (draft.website.trim() !== seeded.website.trim()) {
    const website = normalizeWebsiteInput(draft.website)
    if (website === undefined) invalid.push('website')
    else payload.website = website
  }

  if (draft.born.trim() !== seeded.born.trim()) {
    const born = parseLifeDateInput(draft.born)
    if (!born) invalid.push('born')
    else Object.assign(payload, { birthDate: born.date, birthYear: born.year })
  }

  if (draft.died.trim() !== seeded.died.trim()) {
    const died = parseLifeDateInput(draft.died)
    if (!died) invalid.push('died')
    else Object.assign(payload, { deathDate: died.date, deathYear: died.year })
  }

  if (!sameList(draft.genres, seeded.genres)) payload.genres = draft.genres.length > 0 ? draft.genres : null
  if (!sameList(draft.influences, seeded.influences)) payload.influences = draft.influences.length > 0 ? draft.influences : null

  return { payload, invalid }
}

export function sameFactsDraft(a: AuthorFactsDraft, b: AuthorFactsDraft): boolean {
  return a.website === b.website && a.born === b.born && a.died === b.died && sameList(a.genres, b.genres) && sameList(a.influences, b.influences)
}

// Goodreads supplies a full date for most authors and only a year for older
// ones, so fall back to the year rather than showing nothing.
export function lifeDateLabel(date: string | null | undefined, year: number | null | undefined): string | null {
  if (date) {
    const parsed = new Date(date)
    // Birth and death are plain yyyy-MM-dd, which Date parses as UTC midnight.
    // Formatting that in a timezone behind UTC would render the previous day,
    // so read it back in UTC too.
    if (!Number.isNaN(parsed.getTime())) {
      return formatDate(parsed, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
    }
  }
  // A year is not a quantity: grouping would render 1929 as "1,929".
  return year != null ? formatNumber(year, { useGrouping: false }) : null
}
