// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { fieldCoverage, librariesHidingValues, previewFieldKey, sameLibraries } from '../custom-field-coverage'
import { filterOperatorsFor } from '../custom-field-types'

const libraries = [
  { id: 1, bookCount: 454 },
  { id: 6, bookCount: 10 },
  { id: 3, bookCount: 9 },
]

describe('fieldCoverage', () => {
  it('counts filled books only in the libraries the field is on, and the rest as hidden', () => {
    const field = { enabledLibraryIds: [1, 6], usageByLibrary: { 1: 207, 6: 10, 3: 4 } }

    expect(fieldCoverage(field, libraries)).toEqual({ books: 464, filled: 217, hidden: 4, all: false, none: false })
  })

  it('reports a field on no library as none, with every stored value hidden', () => {
    expect(fieldCoverage({ enabledLibraryIds: [], usageByLibrary: { 1: 2 } }, libraries)).toEqual({
      books: 0,
      filled: 0,
      hidden: 2,
      all: false,
      none: true,
    })
  })

  it('marks a field on every library as all', () => {
    expect(fieldCoverage({ enabledLibraryIds: [1, 6, 3], usageByLibrary: {} }, libraries).all).toBe(true)
  })

  it('treats a missing usage map and book count as zero', () => {
    expect(fieldCoverage({ enabledLibraryIds: [7], usageByLibrary: undefined as never }, [{ id: 7 }])).toEqual({
      books: 0,
      filled: 0,
      hidden: 0,
      all: true,
      none: false,
    })
  })

  it('can measure a draft selection instead of the saved one', () => {
    const field = { enabledLibraryIds: [1], usageByLibrary: { 1: 5, 6: 2 } }

    expect(fieldCoverage(field, libraries, [1, 6])).toMatchObject({ filled: 7, hidden: 0, books: 464 })
  })
})

describe('librariesHidingValues', () => {
  it('lists libraries that would be switched off while holding values', () => {
    const field = { enabledLibraryIds: [1, 6], usageByLibrary: { 1: 3, 6: 2 } }

    expect(librariesHidingValues(field, libraries, [1])).toEqual([{ library: { id: 6, bookCount: 10 }, count: 2 }])
  })

  it('ignores libraries without values', () => {
    expect(librariesHidingValues({ enabledLibraryIds: [1, 3], usageByLibrary: { 1: 3 } }, libraries, [1])).toEqual([])
  })
})

describe('previewFieldKey', () => {
  it('slugifies like the server', () => {
    expect(previewFieldKey('  Original Title (1st ed.) ', [])).toBe('original_title_1st_ed')
    expect(previewFieldKey('Café Notes', [])).toBe('cafe_notes')
  })

  it('falls back when nothing is left of the label', () => {
    expect(previewFieldKey('日本', [])).toBe('custom_field')
  })

  it('adds the server’s numeric suffix when the key is taken', () => {
    expect(previewFieldKey('Edition Note', ['edition_note'])).toBe('edition_note_1')
    expect(previewFieldKey('Edition Note', ['edition_note', 'edition_note_1'])).toBe('edition_note_2')
  })
})

describe('sameLibraries', () => {
  it('ignores order', () => {
    expect(sameLibraries([1, 6], [6, 1])).toBe(true)
    expect(sameLibraries([1], [1, 6])).toBe(false)
  })
})

describe('filterOperatorsFor', () => {
  it('lists the presence operators last, as the filter builder does', () => {
    expect(filterOperatorsFor('boolean')).toEqual(['isTrue', 'isFalse', 'isEmpty', 'isNotEmpty'])
    expect(filterOperatorsFor('number').slice(-2)).toEqual(['isEmpty', 'isNotEmpty'])
  })
})
