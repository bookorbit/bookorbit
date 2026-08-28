// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { authorInitials, authorLetterKey, hasInformativeSortName, isLetterSort } from '../author-identity'

describe('authorInitials', () => {
  it('takes the first and last name', () => {
    expect(authorInitials('Blake Crouch')).toBe('BC')
  })

  it('reads an inverted name the right way round', () => {
    expect(authorInitials('Aurelius, Marcus')).toBe('MA')
    expect(authorInitials('Marcus Aurelius')).toBe('MA')
  })

  it('ignores a parenthesised alias', () => {
    expect(authorInitials('Abbot George Burke (Swami Nirmalananda Giri)')).toBe('AB')
  })

  it('handles initials-only and single-word names', () => {
    expect(authorInitials('J.K. Rowling')).toBe('JR')
    expect(authorInitials('qntm')).toBe('Q')
    expect(authorInitials('SLMN')).toBe('S')
  })

  it('keeps diacritics out of the way', () => {
    expect(authorInitials('Stjepan Šejić')).toBe('SŠ')
    expect(authorInitials('Sjón')).toBe('S')
  })

  it('never returns an empty monogram', () => {
    expect(authorInitials('')).toBe('?')
    expect(authorInitials('   ')).toBe('?')
    expect(authorInitials('!!!')).toBe('?')
  })
})

describe('authorLetterKey', () => {
  const author = (name: string, sortName: string | null = null) => ({ name, sortName })

  it('buckets by display name when sorting by name', () => {
    expect(authorLetterKey(author('Ben Aaronovitch', 'Aaronovitch, Ben'), 'name')).toBe('B')
  })

  it('buckets by sort name when sorting by sort name', () => {
    expect(authorLetterKey(author('Ben Aaronovitch', 'Aaronovitch, Ben'), 'sortName')).toBe('A')
  })

  it('falls back to the display name when the sort name is blank', () => {
    expect(authorLetterKey(author('Ben Aaronovitch', '   '), 'sortName')).toBe('B')
    expect(authorLetterKey(author('Ben Aaronovitch', null), 'sortName')).toBe('B')
  })

  it('folds accents so a name lands in the bucket the rail shows', () => {
    expect(authorLetterKey(author('Élise Fontenaille'), 'name')).toBe('E')
    expect(authorLetterKey(author('Šejić, Stjepan'), 'name')).toBe('S')
  })

  it('buckets anything non-alphabetic under #', () => {
    expect(authorLetterKey(author('47 Ronin'), 'name')).toBe('#')
    expect(authorLetterKey(author('村上春樹'), 'name')).toBe('#')
    expect(authorLetterKey(author(''), 'name')).toBe('#')
  })
})

describe('hasInformativeSortName', () => {
  it('hides a sort name that is only the display name reordered', () => {
    expect(hasInformativeSortName({ name: 'Ben Aaronovitch', sortName: 'Aaronovitch, Ben' })).toBe(false)
    expect(hasInformativeSortName({ name: 'James Islington', sortName: 'ISLINGTON, JAMES' })).toBe(false)
    expect(hasInformativeSortName({ name: 'Welch, J', sortName: 'J, Welch,' })).toBe(false)
  })

  it('shows a sort name that carries something new', () => {
    expect(hasInformativeSortName({ name: 'Douglas Corleone', sortName: 'Unknown' })).toBe(true)
    expect(hasInformativeSortName({ name: 'Dr. Seuss', sortName: 'Seuss' })).toBe(true)
    expect(hasInformativeSortName({ name: 'Ellen Fein', sortName: 'Fein, Ellen & Schneider, Sherrie' })).toBe(true)
  })

  it('treats a missing or blank sort name as nothing to show', () => {
    expect(hasInformativeSortName({ name: 'Blake Crouch', sortName: null })).toBe(false)
    expect(hasInformativeSortName({ name: 'Blake Crouch', sortName: '  ' })).toBe(false)
  })
})

describe('isLetterSort', () => {
  it('is true only for the two alphabetical sorts', () => {
    expect(isLetterSort('name')).toBe(true)
    expect(isLetterSort('sortName')).toBe(true)
    expect(isLetterSort('bookCount')).toBe(false)
    expect(isLetterSort('lastAddedAt')).toBe(false)
    expect(isLetterSort('lastEnrichedAt')).toBe(false)
  })
})
