// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PATTERN_MODIFIERS, findUnbalancedDelimiter, findUnknownModifier, highlightPattern, type PatternPiece } from '../pattern-highlight'

const text = (pieces: PatternPiece[]) => pieces.map((piece) => piece.text).join('')
const kinds = (pieces: PatternPiece[]) => pieces.map((piece) => `${piece.kind}:${piece.text}`)

describe('highlightPattern', () => {
  it('round-trips the pattern so nothing is dropped or duplicated', () => {
    const pattern = '<{authors:first}|Unknown Author>/<{series}/><{seriesIndex}. ><{title}|{originalFilename}>< ({year})>'

    expect(text(highlightPattern(pattern))).toBe(pattern)
  })

  it('splits a modifier away from its token', () => {
    expect(kinds(highlightPattern('{authors:first}'))).toEqual(['token:{authors', 'modifier::first', 'token:}'])
  })

  it('keeps a token without a modifier in one piece', () => {
    expect(kinds(highlightPattern('{title}'))).toEqual(['token:{title}'])
  })

  it('marks optional brackets, the fallback pipe and path separators', () => {
    expect(kinds(highlightPattern('<{series}|Standalone>/'))).toEqual([
      'optional:<',
      'token:{series}',
      'fallback:|',
      'literal:Standalone',
      'optional:>',
      'separator:/',
    ])
  })

  it('flags pieces inside an optional group so the whole run can be tinted', () => {
    const pieces = highlightPattern('a<{year}>b')

    expect(pieces.filter((piece) => piece.optional).map((piece) => piece.text)).toEqual(['<', '{year}', '>'])
    expect(pieces.filter((piece) => !piece.optional).map((piece) => piece.text)).toEqual(['a', 'b'])
  })

  it('treats a pipe outside an optional group as literal text, not a fallback', () => {
    const pieces = highlightPattern('a|b')

    expect(text(pieces)).toBe('a|b')
    expect(pieces.every((piece) => piece.kind === 'literal')).toBe(true)
  })

  it('does not lose an unterminated token', () => {
    expect(text(highlightPattern('{title'))).toBe('{title')
  })

  it('returns nothing for an empty pattern', () => {
    expect(highlightPattern('')).toEqual([])
  })
})

describe('findUnbalancedDelimiter', () => {
  it('accepts a balanced pattern', () => {
    expect(findUnbalancedDelimiter('<{series}/>{title}')).toBeNull()
  })

  it('reports an optional group that is never closed', () => {
    expect(findUnbalancedDelimiter('<{series}/{title}')).toBe('<')
  })

  it('reports a token that is never closed', () => {
    expect(findUnbalancedDelimiter('{title')).toBe('{')
  })

  it('accepts nested optional groups', () => {
    expect(findUnbalancedDelimiter('<<{series}>>')).toBeNull()
  })
})

describe('findUnknownModifier', () => {
  it('accepts every modifier the resolver implements', () => {
    for (const modifier of PATTERN_MODIFIERS) {
      expect(findUnknownModifier(`{authors:${modifier}}`)).toBeNull()
    }
  })

  it('reports a misspelled modifier the resolver would silently ignore', () => {
    expect(findUnknownModifier('{authors:frist}')).toBe('frist')
  })

  it('reports the first unknown modifier in a longer pattern', () => {
    expect(findUnknownModifier('{authors:sort}/{title:shout}/{year:bogus}')).toBe('shout')
  })

  it('accepts a pattern with no modifiers at all', () => {
    expect(findUnknownModifier('{authors}/{title}')).toBeNull()
  })
})
