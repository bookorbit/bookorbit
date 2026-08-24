// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DEFAULT_METADATA_SCORE_WEIGHTS, totalMetadataScoreWeight, type MetadataScoreWeights } from '@bookorbit/types'
import {
  ALL_SCORE_FIELDS,
  changedFields,
  fieldShare,
  fieldsInGroup,
  groupPoints,
  groupShare,
  MAX_FIELD_WEIGHT,
  normalizeWeight,
  normalizeWeights,
  rankedScoreFields,
  scoreComposition,
  scoreFieldLabelKey,
  scoreFieldRuleKey,
  scoringFieldCount,
  splitIntoColumns,
} from '../score-weights'

const defaults = (): MetadataScoreWeights => ({ ...DEFAULT_METADATA_SCORE_WEIGHTS })

describe('score weight totals', () => {
  it('sums only the fields that actually score', () => {
    expect(totalMetadataScoreWeight(defaults())).toBe(78)
  })

  it('leaves a zeroed field out of the denominator entirely', () => {
    const weights = { ...defaults(), description: 0 }
    // 78 - 8, not 78: the field leaves the formula rather than contributing nothing.
    expect(totalMetadataScoreWeight(weights)).toBe(70)
  })

  it('ignores negative weights the same way the server does', () => {
    expect(totalMetadataScoreWeight({ ...defaults(), title: -5 })).toBe(68)
  })
})

describe('fieldShare', () => {
  it('reports a weight as its share of the total', () => {
    expect(fieldShare(defaults(), 'title')).toBeCloseTo((10 / 78) * 100, 5)
  })

  it('gives a switched-off field no share', () => {
    expect(fieldShare(defaults(), 'subtitle')).toBe(0)
  })

  it('is unchanged when every weight is scaled by the same factor', () => {
    const doubled = Object.fromEntries(ALL_SCORE_FIELDS.map((field) => [field, defaults()[field] * 2])) as MetadataScoreWeights
    expect(fieldShare(doubled, 'title')).toBeCloseTo(fieldShare(defaults(), 'title'), 10)
  })

  it('returns zero rather than dividing by zero when nothing scores', () => {
    const none = Object.fromEntries(ALL_SCORE_FIELDS.map((field) => [field, 0])) as MetadataScoreWeights
    expect(fieldShare(none, 'title')).toBe(0)
  })
})

describe('groups', () => {
  it('adds every group share up to 100', () => {
    const sum = scoreComposition(defaults()).reduce((total, segment) => total + segment.share, 0)
    expect(sum).toBeCloseTo(100, 6)
  })

  it('orders composition segments largest first', () => {
    const shares = scoreComposition(defaults()).map((segment) => segment.share)
    expect(shares).toEqual([...shares].sort((a, b) => b - a))
  })

  it('drops a group that contributes nothing', () => {
    const weights = defaults()
    for (const field of fieldsInGroup('providers')) weights[field] = 0
    expect(scoreComposition(weights).some((segment) => segment.group === 'providers')).toBe(false)
  })

  it('counts the eight provider IDs as more of the score than genres', () => {
    expect(groupPoints(defaults(), 'providers')).toBe(8)
    expect(groupShare(defaults(), 'providers')).toBeGreaterThan(fieldShare(defaults(), 'genres'))
  })
})

describe('rankedScoreFields', () => {
  it('sorts by weight and sinks switched-off fields to the bottom', () => {
    const ranked = rankedScoreFields(defaults())
    expect(ranked.slice(0, 3)).toEqual(['title', 'authors', 'coverSource'])
    expect(ranked.slice(-3)).toEqual(['subtitle', 'seriesName', 'seriesIndex'])
  })

  it('keeps every field exactly once', () => {
    expect([...rankedScoreFields(defaults())].sort()).toEqual([...ALL_SCORE_FIELDS].sort())
  })

  it('puts a promoted field above the ones it now outweighs', () => {
    const ranked = rankedScoreFields({ ...defaults(), tags: 20 })
    expect(ranked[0]).toBe('tags')
  })
})

describe('splitIntoColumns', () => {
  it('keeps ranking readable down one column and on into the next', () => {
    expect(splitIntoColumns([1, 2, 3, 4, 5], 2)).toEqual([
      [1, 2, 3],
      [4, 5],
    ])
  })

  it('drops empty columns rather than rendering a blank one', () => {
    expect(splitIntoColumns([1], 2)).toEqual([[1]])
  })
})

describe('normalizeWeight', () => {
  it('clamps out-of-range and non-numeric input', () => {
    expect(normalizeWeight(-4)).toBe(0)
    expect(normalizeWeight(999)).toBe(MAX_FIELD_WEIGHT)
    expect(normalizeWeight(Number.NaN)).toBe(0)
    expect(normalizeWeight('7')).toBe(7)
    expect(normalizeWeight(3.6)).toBe(4)
  })

  it('fills every field when the server omits one', () => {
    const normalized = normalizeWeights({ title: 5 })
    expect(Object.keys(normalized).sort()).toEqual([...ALL_SCORE_FIELDS].sort())
    expect(normalized.title).toBe(5)
    expect(normalized.authors).toBe(0)
  })
})

describe('changedFields and counts', () => {
  it('lists only what moved', () => {
    expect(changedFields({ ...defaults(), tags: 9 }, defaults())).toEqual(['tags'])
  })

  it('counts scoring fields, not all fields', () => {
    expect(scoringFieldCount(defaults())).toBe(21)
  })
})

describe('locale keys', () => {
  it('maps every field to a shared vocabulary key', () => {
    for (const field of ALL_SCORE_FIELDS) {
      expect(scoreFieldLabelKey(field)).toMatch(/^settings\.metadata\.fields\.[A-Za-z0-9]+$/)
    }
  })

  it('describes the trap rules explicitly', () => {
    expect(scoreFieldRuleKey('seriesIndex')).toBe('settings.admin.scoreWeights.rules.seriesIndex')
    expect(scoreFieldRuleKey('coverSource')).toBe('settings.admin.scoreWeights.rules.cover')
    expect(scoreFieldRuleKey('koboId')).toBe('settings.admin.scoreWeights.rules.providerId')
  })
})
