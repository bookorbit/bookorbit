// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { completeToken, matchTokens, partialTokenAt } from '../pattern-tokens'

describe('matchTokens', () => {
  it('offers tokens that start with the query before those that only contain it', () => {
    expect(matchTokens('ser')).toEqual(['series', 'seriesIndex', 'series[1]', 'seriesIndex[1]'])
    expect(matchTokens('index')).toEqual(['seriesIndex', 'seriesIndex[1]'])
  })

  it('offers every token for an empty query and none for a stranger', () => {
    expect(matchTokens('')).toContain('firstPublishedYear')
    expect(matchTokens('zzz')).toEqual([])
  })
})

describe('partialTokenAt', () => {
  it('finds the open brace and the letters typed after it', () => {
    expect(partialTokenAt('{authors}/{ti', 13)).toEqual({ start: 10, query: 'ti' })
  })

  it('ignores a finished token and a modifier', () => {
    expect(partialTokenAt('{title}', 7)).toBeNull()
    expect(partialTokenAt('{authors:fi', 11)).toBeNull()
  })
})

describe('completeToken', () => {
  it('replaces the partial token and places the caret after it', () => {
    expect(completeToken('{authors}/{ti', 10, 13, 'title')).toEqual({ pattern: '{authors}/{title}', caret: 17 })
  })

  it('completes an indexed token even with its selector after the caret', () => {
    expect(partialTokenAt('{series[', 8)).toEqual({ start: 0, query: 'series[' })
    expect(matchTokens('series[')).toEqual(['series[1]'])
    expect(matchTokens('seriesIndex[0')).toEqual(['seriesIndex[0]'])
    expect(matchTokens('series[12]')).toEqual(['series[12]'])
    expect(completeToken('{series[2]}/x', 0, 8, 'series[1]')).toEqual({ pattern: '{series[1]}/x', caret: 11 })
  })

  it('swallows letters and a closing brace already after the caret', () => {
    expect(completeToken('{ti}/x', 0, 3, 'title')).toEqual({ pattern: '{title}/x', caret: 7 })
  })
})
