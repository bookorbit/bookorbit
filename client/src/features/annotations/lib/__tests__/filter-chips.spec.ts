import { describe, it, expect } from 'vitest'
import { buildFilterChips, dateRangeLabel } from '../filter-chips'

describe('dateRangeLabel', () => {
  it('formats both, from-only, and to-only ranges', () => {
    expect(dateRangeLabel('2026-01-01', '2026-01-31')).toBe('2026-01-01 to 2026-01-31')
    expect(dateRangeLabel('2026-01-01', '')).toBe('From 2026-01-01')
    expect(dateRangeLabel('', '2026-01-31')).toBe('Until 2026-01-31')
  })
})

describe('buildFilterChips', () => {
  it('returns an empty list when no filters are active', () => {
    expect(buildFilterChips({ colors: [], dateFrom: '', dateTo: '' })).toEqual([])
    expect(buildFilterChips({ colors: [], styleFilter: 'all', originFilter: 'all', dateFrom: '', dateTo: '' })).toEqual([])
  })

  it('builds one chip per color, resolving both app and KOReader-exact labels', () => {
    const chips = buildFilterChips({ colors: ['#FACC15', '#FF3300'], dateFrom: '', dateTo: '' })
    expect(chips).toEqual([
      { id: 'color:#FACC15', label: 'Color: Yellow' },
      { id: 'color:#FF3300', label: 'Color: KOReader Red' },
    ])
  })

  it('builds style, origin, and date chips when set', () => {
    const chips = buildFilterChips({
      colors: [],
      styleFilter: 'underline',
      originFilter: 'koreader',
      dateFrom: '2026-01-01',
      dateTo: '2026-02-01',
    })
    expect(chips.map((chip) => chip.id)).toEqual(['style', 'origin', 'date'])
    expect(chips[0].label).toBe('Style: Underline')
    expect(chips[1].label).toBe('Source: KOReader')
    expect(chips[2].label).toBe('Date: 2026-01-01 to 2026-02-01')
  })
})
