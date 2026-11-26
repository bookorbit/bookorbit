import { describe, expect, it } from 'vitest'
import type { SeriesUnitCounts } from '@bookorbit/types'
import { i18n } from '@/i18n'
import {
  chapterCountLabel,
  chapterGroupUnit,
  gapListPreview,
  ladderNumberToken,
  seriesGapTokens,
  seriesHasChapters,
  seriesHasMixedUnits,
  seriesNameWithPosition,
  seriesPositionToken,
  seriesPositionWithTitle,
  seriesUnitCountsLabel,
  titleContainsPositionToken,
} from './series-unit-label'

const t = i18n.global.t as (key: string, values?: Record<string, unknown>) => string

function counts(overrides: Partial<SeriesUnitCounts> = {}): SeriesUnitCounts {
  return { volume: 0, chapter: 0, issue: 0, ...overrides }
}

describe('seriesPositionToken', () => {
  it('names the unit of the position', () => {
    expect(seriesPositionToken(t, '3', 'volume')).toBe('Vol. 3')
    expect(seriesPositionToken(t, '84', 'chapter')).toBe('Ch. 84')
    expect(seriesPositionToken(t, '12', 'issue')).toBe('#12')
  })

  it('keeps the bare number for an unclassified position', () => {
    expect(seriesPositionToken(t, '3', null)).toBe('#3')
    expect(seriesPositionToken(t, '3.0', undefined)).toBe('#3.0')
  })

  it('accepts a numeric gap', () => {
    expect(seriesPositionToken(t, 93, 'chapter')).toBe('Ch. 93')
  })
})

describe('seriesNameWithPosition', () => {
  it('follows the name with the token', () => {
    expect(seriesNameWithPosition(t, 'Harbor of Lanterns', '87', 'chapter')).toBe('Harbor of Lanterns Ch. 87')
    expect(seriesNameWithPosition(t, 'Dune', '2', null)).toBe('Dune #2')
    expect(seriesNameWithPosition(t, 'Dune', null, 'volume')).toBe('Dune')
  })
})

describe('titleContainsPositionToken', () => {
  it('finds the token the title already carries', () => {
    expect(titleContainsPositionToken('Harbor of Lanterns, Vol. 3', 'Vol. 3')).toBe(true)
    expect(titleContainsPositionToken('Vol. 2: Iron Bells', 'Vol. 2')).toBe(true)
    expect(titleContainsPositionToken('Night Warden #12', '#12')).toBe(true)
  })

  it('does not match a longer number that starts the same way', () => {
    expect(titleContainsPositionToken('Night Warden #12', '#1')).toBe(false)
    expect(titleContainsPositionToken('Harbor of Lanterns, Vol. 10', 'Vol. 1')).toBe(false)
    expect(titleContainsPositionToken('Ch. 3.5 Interlude', 'Ch. 3')).toBe(false)
  })
})

describe('seriesPositionWithTitle', () => {
  it('leads with the token', () => {
    expect(seriesPositionWithTitle(t, '93', 'chapter', 'Embers')).toBe('Ch. 93 · Embers')
    expect(seriesPositionWithTitle(t, '12', 'issue', 'The Long Night')).toBe('#12 · The Long Night')
  })

  it('drops the token when the title already says it', () => {
    expect(seriesPositionWithTitle(t, '4', 'volume', 'Harbor of Lanterns, Vol. 4')).toBe('Harbor of Lanterns, Vol. 4')
    expect(seriesPositionWithTitle(t, '12', 'issue', 'Night Warden #12')).toBe('Night Warden #12')
  })

  it('keeps the old form for an unclassified position, even when the title repeats it', () => {
    expect(seriesPositionWithTitle(t, '93', null, 'Embers')).toBe('#93 · Embers')
    expect(seriesPositionWithTitle(t, '12', null, 'Night Warden #12')).toBe('#12 · Night Warden #12')
  })

  it('shows only the title without a position', () => {
    expect(seriesPositionWithTitle(t, null, 'chapter', 'Embers')).toBe('Embers')
  })
})

describe('unit counts', () => {
  it('offers kind tabs only when a series holds both volumes and chapters', () => {
    expect(seriesHasMixedUnits(counts({ volume: 10, chapter: 20 }))).toBe(true)
    expect(seriesHasMixedUnits(counts({ volume: 2, issue: 16 }))).toBe(true)
    expect(seriesHasMixedUnits(counts({ volume: 10 }))).toBe(false)
    expect(seriesHasMixedUnits(counts({ chapter: 20 }))).toBe(false)
    expect(seriesHasMixedUnits(undefined)).toBe(false)
  })

  it('treats issues as chapters', () => {
    expect(seriesHasChapters(counts({ issue: 1 }))).toBe(true)
    expect(seriesHasChapters(counts({ volume: 3 }))).toBe(false)
    expect(seriesHasChapters(null)).toBe(false)
  })

  it('names the chapter group after the kind the series holds more of', () => {
    expect(chapterGroupUnit(counts({ chapter: 5, issue: 6 }))).toBe('issue')
    expect(chapterGroupUnit(counts({ chapter: 6, issue: 6 }))).toBe('chapter')
    expect(chapterCountLabel(t, counts({ issue: 16 }))).toBe('16 issues')
    expect(chapterCountLabel(t, counts({ chapter: 1 }))).toBe('1 chapter')
  })

  it('describes both kinds in one line', () => {
    expect(seriesUnitCountsLabel(t, counts({ volume: 10, chapter: 20 }))).toBe('10 volumes · 20 chapters')
    expect(seriesUnitCountsLabel(t, counts({ volume: 1, issue: 16 }))).toBe('1 volume · 16 issues')
    expect(seriesUnitCountsLabel(t, counts({ chapter: 20 }))).toBe('20 chapters')
  })

  it('leaves a series of volumes to its own wording', () => {
    expect(seriesUnitCountsLabel(t, counts({ volume: 10 }))).toBeNull()
    expect(seriesUnitCountsLabel(t, undefined)).toBeNull()
  })
})

describe('seriesGapTokens', () => {
  it('names gaps by kind once a series has chapters', () => {
    expect(seriesGapTokens(t, [5], [93, 95], counts({ volume: 10, chapter: 20 }))).toEqual(['Vol. 5', 'Ch. 93', 'Ch. 95'])
    expect(seriesGapTokens(t, [], [13, 14], counts({ volume: 2, issue: 16 }))).toEqual(['#13', '#14'])
  })

  it('names the gaps of a series with no volumes once, since both lists carry them', () => {
    expect(seriesGapTokens(t, [3], [3], counts({ issue: 3 }))).toEqual(['#3'])
    expect(seriesGapTokens(t, [82], [82], counts({ chapter: 3 }))).toEqual(['Ch. 82'])
  })

  it('keeps the bare number for a series without chapters', () => {
    expect(seriesGapTokens(t, [13], [], counts({ volume: 10 }))).toEqual(['#13'])
    expect(seriesGapTokens(t, [13], [], undefined)).toEqual(['#13'])
  })
})

describe('ladderNumberToken', () => {
  it('names a rung by the kind the ladder runs on', () => {
    expect(ladderNumberToken(t, 3, counts({ volume: 4, chapter: 2 }))).toBe('Vol. 3')
    expect(ladderNumberToken(t, 3, counts({ chapter: 4 }))).toBe('Ch. 3')
    expect(ladderNumberToken(t, 3, counts({ issue: 4 }))).toBe('#3')
    expect(ladderNumberToken(t, 3, counts({ volume: 4 }))).toBe('#3')
  })
})

describe('gapListPreview', () => {
  it('counts what the preview left out', () => {
    expect(gapListPreview(t, ['Ch. 93', 'Ch. 95'], 2)).toBe('Ch. 93, Ch. 95')
    expect(gapListPreview(t, ['Ch. 93', 'Ch. 95'], 5)).toBe('Ch. 93, Ch. 95 +3')
  })
})
