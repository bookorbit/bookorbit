import { describe, expect, it } from 'vitest'
import { groupByLetter, highlightSegments, letterOf, taxonomyRouteNames } from './taxonomy-text'

describe('letterOf', () => {
  it('files a name under its first letter, ignoring case and accents', () => {
    expect(letterOf('fantasy')).toBe('F')
    expect(letterOf('Épopée')).toBe('E')
    expect(letterOf('  Ödön')).toBe('O')
  })

  it('files names that do not start with a Latin letter under #', () => {
    expect(letterOf('1984')).toBe('#')
    expect(letterOf('¡Hola!')).toBe('#')
    expect(letterOf('日本')).toBe('#')
    expect(letterOf('')).toBe('#')
  })
})

describe('highlightSegments', () => {
  it('marks the first match without changing the name as written', () => {
    expect(highlightSegments('Epic Fantasy', 'fan')).toEqual([
      { text: 'Epic ', match: false },
      { text: 'Fan', match: true },
      { text: 'tasy', match: false },
    ])
  })

  it('matches across accents in either direction', () => {
    expect(highlightSegments('Mystère', 'myster')).toEqual([
      { text: 'Mystèr', match: true },
      { text: 'e', match: false },
    ])
    expect(highlightSegments('Mystere', 'mystère')).toEqual([{ text: 'Mystere', match: true }])
  })

  it('keeps the name whole when the query is blank or does not match', () => {
    expect(highlightSegments('Horror', '   ')).toEqual([{ text: 'Horror', match: false }])
    expect(highlightSegments('Horror', 'romance')).toEqual([{ text: 'Horror', match: false }])
  })

  it('maps a match after a decomposed character back to the right place', () => {
    const name = 'Café Noir'
    const segments = highlightSegments(name, 'noir')
    expect(segments.map((segment) => segment.text).join('')).toBe(name)
    expect(segments.find((segment) => segment.match)?.text).toBe('Noir')
  })
})

describe('groupByLetter', () => {
  const items = [{ name: '1984' }, { name: 'Adventure' }, { name: 'Alt History' }, { name: 'Épique' }, { name: 'Fantasy' }]

  it('groups name-sorted items under their letters, in order', () => {
    const groups = groupByLetter(items, true)
    expect(groups.map((group) => [group.label, group.items.length])).toEqual([
      ['#', 1],
      ['A', 2],
      ['E', 1],
      ['F', 1],
    ])
    expect(new Set(groups.map((group) => group.key)).size).toBe(groups.length)
  })

  it('opens a new group when a letter comes back later in the list', () => {
    const groups = groupByLetter([{ name: 'Alpha' }, { name: 'Beta' }, { name: 'Another' }], true)
    expect(groups.map((group) => group.label)).toEqual(['A', 'B', 'A'])
    expect(new Set(groups.map((group) => group.key)).size).toBe(3)
  })

  it('keeps everything in one unlabelled group when not sorted by name', () => {
    expect(groupByLetter(items, false)).toEqual([{ key: 'all', label: null, items }])
    expect(groupByLetter([], false)).toEqual([])
    expect(groupByLetter([], true)).toEqual([])
  })
})

describe('taxonomyRouteNames', () => {
  it('names the index and page routes for each kind', () => {
    expect(taxonomyRouteNames('genre')).toEqual({ index: 'genres', detail: 'genre-detail' })
    expect(taxonomyRouteNames('tag')).toEqual({ index: 'tags', detail: 'tag-detail' })
  })
})
