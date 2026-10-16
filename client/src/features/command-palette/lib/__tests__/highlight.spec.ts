// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { highlightSegments } from '../highlight'

describe('highlightSegments', () => {
  it('marks every case-insensitive occurrence and keeps the original casing', () => {
    expect(highlightSegments('The Kingdom of the King', 'king')).toEqual([
      { text: 'The ', match: false },
      { text: 'King', match: true },
      { text: 'dom of the ', match: false },
      { text: 'King', match: true },
    ])
  })

  it('treats regular-expression characters in the query literally', () => {
    expect(highlightSegments('Who? (Part 1)', '(part')).toEqual([
      { text: 'Who? ', match: false },
      { text: '(Part', match: true },
      { text: ' 1)', match: false },
    ])
  })

  it('returns the text as one plain segment for an empty query', () => {
    expect(highlightSegments('Carrie', '  ')).toEqual([{ text: 'Carrie', match: false }])
  })
})
