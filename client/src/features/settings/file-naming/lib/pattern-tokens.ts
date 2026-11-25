import { PATTERN_TOKENS, type PatternToken } from '@bookorbit/types'
import { PATTERN_MODIFIERS, type PatternModifier } from './pattern-highlight'

// Written out rather than derived from the token name so a renamed message key fails
// the locale check instead of silently rendering the raw key.
export const TOKEN_DESCRIPTION_KEYS: Record<PatternToken, string> = {
  title: 'settings.reader.fileNaming.tokenTitle',
  subtitle: 'settings.reader.fileNaming.tokenSubtitle',
  authors: 'settings.reader.fileNaming.tokenAuthors',
  narrators: 'settings.reader.fileNaming.tokenNarrators',
  year: 'settings.reader.fileNaming.tokenYear',
  firstPublishedYear: 'settings.reader.fileNaming.tokenFirstPublishedYear',
  'series[1]': 'settings.reader.fileNaming.tokenIndexedSeries',
  'seriesIndex[1]': 'settings.reader.fileNaming.tokenIndexedSeriesIndex',
  series: 'settings.reader.fileNaming.tokenSeries',
  seriesIndex: 'settings.reader.fileNaming.tokenSeriesIndex',
  publisher: 'settings.reader.fileNaming.tokenPublisher',
  isbn: 'settings.reader.fileNaming.tokenIsbn',
  language: 'settings.reader.fileNaming.tokenLanguage',
  library: 'settings.reader.fileNaming.tokenLibrary',
  originalFilename: 'settings.reader.fileNaming.tokenOriginalFilename',
  extension: 'settings.reader.fileNaming.tokenExtension',
  readaloud: 'settings.reader.fileNaming.tokenReadaloud',
}

export const MODIFIER_DESCRIPTION_KEYS: Record<PatternModifier, string> = {
  first: 'settings.reader.fileNaming.modFirst',
  sort: 'settings.reader.fileNaming.modSort',
  initial: 'settings.reader.fileNaming.modInitial',
  fixed2: 'settings.reader.fileNaming.modFixed2',
  max3: 'settings.reader.fileNaming.modMax3',
  upper: 'settings.reader.fileNaming.modUpper',
  lower: 'settings.reader.fileNaming.modLower',
}

type SeriesSelector = `${'series' | 'seriesIndex'}[${number}]`
export type SuggestedToken = PatternToken | SeriesSelector

export function suggestionDescriptionKey(token: SuggestedToken): string {
  return TOKEN_DESCRIPTION_KEYS[token.replace(/\[\d+\]$/, '[1]') as PatternToken]
}

export const TOKEN_NAMES: PatternToken[] = PATTERN_TOKENS.map((entry) => entry.token)
export const MODIFIER_NAMES: readonly PatternModifier[] = PATTERN_MODIFIERS

/**
 * Tokens matching what has been typed after a `{`: those starting with it first, then those
 * containing it, so `{ser` offers series before seriesIndex and `{index` still finds seriesIndex.
 */
export function matchTokens(query: string): SuggestedToken[] {
  const indexed = /^(series|seriesIndex)\[(0|[1-9]\d*)\]?$/.exec(query)
  if (indexed) return [`${indexed[1]}[${indexed[2]}]` as SeriesSelector]

  const needle = query.toLowerCase()
  if (!needle) return [...TOKEN_NAMES]
  const starts = TOKEN_NAMES.filter((token) => token.toLowerCase().startsWith(needle))
  const contains = TOKEN_NAMES.filter((token) => !token.toLowerCase().startsWith(needle) && token.toLowerCase().includes(needle))
  return [...starts, ...contains]
}

/**
 * The partial token at the caret can include an unfinished series selector.
 * Returns where the brace is and what follows it, or null when the caret is not in one.
 */
export function partialTokenAt(pattern: string, caret: number): { start: number; query: string } | null {
  const before = pattern.slice(0, caret)
  const open = before.lastIndexOf('{')
  if (open === -1) return null
  const typed = before.slice(open + 1)
  if (!/^(?:[A-Za-z]*|series(?:Index)?\[\d*\]?)$/.test(typed)) return null
  return { start: open, query: typed }
}

/** Replaces the partial token with a whole one, swallowing letters and a brace already after the caret. */
export function completeToken(pattern: string, start: number, caret: number, token: string): { pattern: string; caret: number } {
  const existing = pattern.slice(start + 1).match(/^[A-Za-z]*(?:\[\d*\]?)?\}?/)![0]
  const rest = pattern.slice(Math.max(caret, start + 1 + existing.length))
  const inserted = `{${token}}`
  return { pattern: pattern.slice(0, start) + inserted + rest, caret: start + inserted.length }
}
