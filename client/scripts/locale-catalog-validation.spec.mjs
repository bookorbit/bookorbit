import { describe, expect, it } from 'vitest'
import { flattenCatalog, validateCatalogs } from './locale-catalog-validation.mjs'

function catalogs(target = {}) {
  return new Map([
    [
      'en',
      flattenCatalog({
        common: { save: 'Save' },
        books: { count: '{count, plural, one {# book} other {# books}}' },
      }),
    ],
    ['cs', flattenCatalog(target)],
  ])
}

describe('locale catalog validation', () => {
  it('reports invalid catalog objects with their path', () => {
    expect(() => flattenCatalog(null)).toThrow('catalog root must be a message object')
    expect(() => flattenCatalog(null, 'common')).toThrow('common must be a message object')
  })

  it('accepts a sparse target catalog', () => {
    expect(validateCatalogs({ catalogs: catalogs({ common: { save: 'Uložit' } }) })).toEqual([])
  })

  it('rejects unknown and empty target messages', () => {
    expect(validateCatalogs({ catalogs: catalogs({ common: { save: '', unknown: 'Neznámé' } }) })).toEqual([
      'cs: empty message common.save',
      'cs: unexpected key common.unknown',
    ])
  })

  it('validates ICU structure for translated messages that are present', () => {
    const target = {
      books: { count: '{count, plural, one {# kniha} other {# knih}}' },
    }

    expect(validateCatalogs({ catalogs: catalogs(target) })).toEqual([
      'cs: ICU plural category few missing for books.count',
      'cs: ICU plural category many missing for books.count',
    ])
  })
})
