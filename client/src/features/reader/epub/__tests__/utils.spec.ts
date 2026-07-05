import { describe, expect, it } from 'vitest'
import {
  cfiRangesMatch,
  cfiRangesOverlap,
  findMatchingCfiRange,
  findNearestCfi,
  formatCfiLocation,
  formatDate,
  getCfiSortKey,
  stripFragment,
} from '../utils'

describe('epub utils', () => {
  it('removes hash fragments from href values', () => {
    expect(stripFragment('chapter-1.xhtml#start')).toBe('chapter-1.xhtml')
    expect(stripFragment('chapter-2.xhtml')).toBe('chapter-2.xhtml')
    expect(stripFragment('')).toBe('')
  })

  it('formats dates using locale short month/day/year format', () => {
    const iso = '2026-02-14T12:00:00.000Z'
    const expected = new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

    expect(formatDate(iso)).toBe(expected)
  })

  it('formats CFI locations from spine step values', () => {
    expect(formatCfiLocation('epubcfi(/6/8!/4/2/2:0)')).toBe('Loc 4')
    expect(formatCfiLocation('epubcfi(/6/2!/4/2/2:0)')).toBe('Loc 1')
  })

  it('falls back to a compact CFI label when spine location is unavailable', () => {
    expect(formatCfiLocation('epubcfi(/foo/bar/baz/qux/quux)')).toBe('CFI /foo/bar/baz/qux/quux')
  })

  it('returns null for empty CFI values', () => {
    expect(formatCfiLocation(null)).toBeNull()
    expect(formatCfiLocation(undefined)).toBeNull()
    expect(formatCfiLocation('')).toBeNull()
  })

  it('builds comparable CFI sort keys', () => {
    const early = getCfiSortKey('epubcfi(/6/2!/4/2/2:0)')
    const later = getCfiSortKey('epubcfi(/6/10!/4/2/2:0)')
    expect(early).not.toBeNull()
    expect(later).not.toBeNull()
    expect(early! < later!).toBe(true)
  })

  it('returns null sort keys for invalid CFI values', () => {
    expect(getCfiSortKey(null)).toBeNull()
    expect(getCfiSortKey('not-a-cfi')).toBeNull()
  })

  it('finds the nearest CFI relative to current location', () => {
    const items = [
      { id: 1, cfi: 'epubcfi(/6/2)' },
      { id: 2, cfi: 'epubcfi(/6/8)' },
      { id: 3, cfi: 'epubcfi(/6/14)' },
    ]
    const nearest = findNearestCfi(items, 'epubcfi(/6/10)')
    expect(nearest?.id).toBe(2)
  })

  it('returns null when current CFI cannot be parsed', () => {
    const items = [{ id: 1, cfi: 'epubcfi(/6/2)' }]
    expect(findNearestCfi(items, 'bad-cfi')).toBeNull()
  })
})

describe('cfiRangesOverlap', () => {
  const ann = 'epubcfi(/6/4!/4/2,/2/1:0,/2/1:20)'

  it('detects exact CFI match as overlapping', () => {
    expect(cfiRangesOverlap(ann, ann)).toBe(true)
  })

  it('detects a subset selection inside an annotation as overlapping', () => {
    const subset = 'epubcfi(/6/4!/4/2,/2/1:5,/2/1:10)'
    expect(cfiRangesOverlap(subset, ann)).toBe(true)
  })

  it('detects a superset selection around an annotation as overlapping', () => {
    const superset = 'epubcfi(/6/4!/4/2,/2/1:0,/2/1:50)'
    expect(cfiRangesOverlap(superset, ann)).toBe(true)
  })

  it('detects a partially overlapping selection as overlapping', () => {
    const partial = 'epubcfi(/6/4!/4/2,/2/1:10,/2/1:30)'
    expect(cfiRangesOverlap(partial, ann)).toBe(true)
  })

  it('returns false when selection is entirely before annotation', () => {
    const clearlyBefore = 'epubcfi(/6/2!/4/2,/2/1:0,/2/1:5)'
    expect(cfiRangesOverlap(clearlyBefore, ann)).toBe(false)
  })

  it('returns false when selection is in a different spine item', () => {
    const otherSpine = 'epubcfi(/6/6!/4/2,/2/1:0,/2/1:20)'
    expect(cfiRangesOverlap(otherSpine, ann)).toBe(false)
  })

  it('returns false for non-range (point) CFIs', () => {
    const point = 'epubcfi(/6/4!/4/2/2/1:5)'
    expect(cfiRangesOverlap(point, ann)).toBe(false)
  })

  it('returns false for invalid CFI strings', () => {
    expect(cfiRangesOverlap('not-a-cfi', ann)).toBe(false)
    expect(cfiRangesOverlap(ann, 'not-a-cfi')).toBe(false)
  })
})

describe('cfiRangesMatch', () => {
  const ann = 'epubcfi(/6/4!/4/2,/2/1:0,/2/1:20)'

  it('detects exact range matches', () => {
    expect(cfiRangesMatch(ann, ann)).toBe(true)
  })

  it('does not treat subset selections as the existing annotation range', () => {
    const subset = 'epubcfi(/6/4!/4/2,/2/1:5,/2/1:10)'
    expect(cfiRangesOverlap(subset, ann)).toBe(true)
    expect(cfiRangesMatch(subset, ann)).toBe(false)
  })

  it('does not treat superset or partial overlaps as the existing annotation range', () => {
    const superset = 'epubcfi(/6/4!/4/2,/2/1:0,/2/1:50)'
    const partial = 'epubcfi(/6/4!/4/2,/2/1:10,/2/1:30)'

    expect(cfiRangesOverlap(superset, ann)).toBe(true)
    expect(cfiRangesOverlap(partial, ann)).toBe(true)
    expect(cfiRangesMatch(superset, ann)).toBe(false)
    expect(cfiRangesMatch(partial, ann)).toBe(false)
  })

  it('returns false for different spine items and invalid CFI strings', () => {
    expect(cfiRangesMatch('epubcfi(/6/6!/4/2,/2/1:0,/2/1:20)', ann)).toBe(false)
    expect(cfiRangesMatch('not-a-cfi', ann)).toBe(false)
    expect(cfiRangesMatch(ann, 'not-a-cfi')).toBe(false)
  })
})

describe('findMatchingCfiRange', () => {
  const ann = { id: 1, cfi: 'epubcfi(/6/4!/4/2,/2/1:0,/2/1:20)' }

  it('returns an annotation only when the selected range exactly matches it', () => {
    expect(findMatchingCfiRange([ann], ann.cfi)?.id).toBe(1)
  })

  it('does not return a parent annotation when the selection is only a subset', () => {
    const subset = 'epubcfi(/6/4!/4/2,/2/1:5,/2/1:10)'

    expect(cfiRangesOverlap(subset, ann.cfi)).toBe(true)
    expect(findMatchingCfiRange([ann], subset)).toBeNull()
  })

  it('returns null when there is no selected CFI', () => {
    expect(findMatchingCfiRange([ann], null)).toBeNull()
  })
})
