/**
 * Thirty-five rows that all begin `01. The Three-Body Problem (2014)-` say the stem thirty-five
 * times and the part number once. Hoisting the stem into the group header and leaving the rows to
 * carry only what differs is the difference between a scannable track list and a wall of near
 * identical strings.
 */

const SEPARATORS = /[\s\-_.]+$/
const LEADING_SEPARATORS = /^[\s\-_.)\]]+/
const TRAILING_WORD = /[A-Za-z0-9]+$/
const WITH_EXTENSION = /^(.+)\.[a-z0-9]{1,8}$/i

/** Shortest stem worth hoisting: below this the rows lose more than they gain. */
const MIN_STEM_LENGTH = 8
/** A stem has to describe most of the folder, not just the two files that happen to sort together. */
const MIN_COVERAGE = 0.7

/** What is left of `name` once `stem` and any separator joining the two are removed. */
export function stemTail(name: string, stem: string): string | null {
  return name.startsWith(stem) ? name.slice(stem.length).replace(LEADING_SEPARATORS, '') : null
}

/** The tail without its extension, or null when the tail is not a usable filename in its own right. */
function tailBase(name: string, stem: string): string | null {
  const tail = stemTail(name, stem)
  if (tail == null) return null
  const base = WITH_EXTENSION.exec(tail)?.[1]
  return base != null && base.length >= 2 ? base : null
}

/**
 * A stem earns its place only when most names keep a distinct, still-readable tail. Without the
 * distinctness test a shelf of `Ticktock - Dean Koontz.epub` would render as a column of `Koontz`.
 */
function isUsableStem(stem: string, names: string[]): boolean {
  if (stem.length < MIN_STEM_LENGTH) return false
  const bases = names.map((name) => tailBase(name, stem)).filter((base): base is string => base != null)
  const required = Math.max(3, Math.ceil(names.length * MIN_COVERAGE))
  return bases.length >= required && new Set(bases).size >= Math.ceil(bases.length * MIN_COVERAGE)
}

/**
 * The stem shared by `names`, or an empty string when there is nothing worth hoisting.
 *
 * A plain common prefix is too brittle for a real folder: one stray `Book (2014).mp3` among
 * thirty-four `Book (2014)-PartNN.mp3` collapses it to nothing. Taking the median of neighbouring
 * prefixes instead lets the outliers keep their full name without costing everyone else theirs.
 */
export function commonStem(names: string[]): string {
  if (names.length < 3) return ''

  const sorted = [...names].sort()
  const prefixLengths: number[] = []
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const left = sorted[index] ?? ''
    const right = sorted[index + 1] ?? ''
    let shared = 0
    while (shared < left.length && shared < right.length && left[shared] === right[shared]) shared += 1
    prefixLengths.push(shared)
  }
  prefixLengths.sort((a, b) => a - b)

  const medianLength = prefixLengths[Math.floor(prefixLengths.length / 2)] ?? 0
  const median = (sorted[0] ?? '').slice(0, medianLength).replace(SEPARATORS, '')
  // Cutting back to a word boundary turns rows reading "02.mp3" into "Part02.mp3".
  const withoutDanglingWord = median.replace(TRAILING_WORD, '').replace(SEPARATORS, '')

  if (isUsableStem(withoutDanglingWord, names)) return withoutDanglingWord
  return isUsableStem(median, names) ? median : ''
}

export type StemmedName = {
  /** What the row shows: the tail when the stem applies, the whole filename when it does not. */
  display: string
  /** The stem this name actually gave up, so an outlier can be told apart from the rest. */
  stem: string
}

/** Applies {@link commonStem} to a list, leaving names it does not fit untouched. */
export function applyCommonStem(names: string[]): { stem: string; names: StemmedName[] } {
  const stem = commonStem(names)
  return {
    stem,
    names: names.map((name) => {
      const tail = stem ? (tailBase(name, stem) != null ? stemTail(name, stem) : null) : null
      return tail ? { display: tail, stem } : { display: name, stem: '' }
    }),
  }
}

/**
 * Splits a filename so the extension can be rendered as its own element. A files list that
 * truncates `Ticktock - Dean Koontz.epub` to `Ticktock - Dean ...` has hidden the one thing it
 * exists to show, so the extension never shares a text node with the part that can be clipped.
 */
export function splitExtension(name: string): { base: string; extension: string } {
  const match = /^(.*)(\.[A-Za-z0-9]{1,8})$/.exec(name)
  return match ? { base: match[1] ?? name, extension: match[2] ?? '' } : { base: name, extension: '' }
}
