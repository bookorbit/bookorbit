import { describe, expect, it } from 'vitest'
import { findNearestCfi, formatCfiLocation, formatDate, getCfiSortKey, stripFragment } from '../utils'

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
