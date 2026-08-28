import type { AuthorSummary } from '@bookorbit/types'
import type { AuthorListSort } from '../types/author'

/**
 * Initials for the monogram an author falls back to when there is no portrait and
 * none of their books carries cover art. Parenthesised suffixes and punctuation are
 * dropped, and an inverted "Surname, Forename" is read back the right way round so
 * "Aurelius, Marcus" and "Marcus Aurelius" produce the same pair.
 */
export function authorInitials(name: string): string {
  const withoutAlias = name.replace(/\(.*?\)/g, ' ')
  // The comma decides the reading order, so the swap has to happen before
  // punctuation is stripped - otherwise "Aurelius, Marcus" reads as AM, not MA.
  const strip = (value: string) => value.replace(/[^\p{L}\p{N}\s.'-]/gu, ' ').trim()
  const ordered = strip(withoutAlias.includes(',') ? withoutAlias.split(',').reverse().join(' ') : withoutAlias)
  if (!ordered) return '?'

  const letters = ordered
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.match(/\p{L}/u)?.[0] ?? '')
    .filter(Boolean)

  if (letters.length === 0) return '?'
  const first = letters[0] ?? ''
  const last = letters.length > 1 ? (letters[letters.length - 1] ?? '') : ''
  return (first + last).toUpperCase()
}

/**
 * The A-Z bucket an author belongs to, mirroring the server's bucket expression in
 * `AuthorsRepository.letterBucketExpr`. Both sides fold accents and bucket anything
 * non-alphabetic to "#", so a section heading always agrees with the jump rail.
 */
export function authorLetterKey(author: Pick<AuthorSummary, 'name' | 'sortName'>, sort: AuthorListSort): string {
  const key = sort === 'sortName' ? author.sortName?.trim() || author.name : author.name
  const initial = key
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .charAt(0)
    .toUpperCase()
  return initial >= 'A' && initial <= 'Z' ? initial : '#'
}

/** Only the alphabetical sorts have letter buckets; the rest have no rail. */
export function isLetterSort(sort: AuthorListSort): sort is 'name' | 'sortName' {
  return sort === 'name' || sort === 'sortName'
}

/**
 * A sort name earns its own line only when it says something the display name does
 * not. In a real library the overwhelming majority are the display name reordered
 * ("Ben Aaronovitch" / "Aaronovitch, Ben"), and printing those beside the name is
 * noise on every row. Comparing letter multisets catches every reordering, while
 * still surfacing the ones that carry new information ("Unknown", a co-author).
 */
export function hasInformativeSortName(author: Pick<AuthorSummary, 'name' | 'sortName'>): boolean {
  const sortName = author.sortName?.trim()
  if (!sortName) return false
  return letterSignature(sortName) !== letterSignature(author.name)
}

function letterSignature(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .split('')
    .sort()
    .join('')
}
