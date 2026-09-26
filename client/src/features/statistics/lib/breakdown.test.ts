import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/echarts', () => ({
  readCssColor: (varName: string) => `rgb(${varName})`,
  oklchToHex: () => '#000000',
}))

import { BREAKDOWN_OPTIONS, DEFAULT_BREAKDOWN_DIMENSION, getBreakdownColor, getBreakdownSeries } from './breakdown'

describe('breakdown', () => {
  it('defaults source-or-format charts to format', () => {
    expect(DEFAULT_BREAKDOWN_DIMENSION).toBe('format')
    expect(BREAKDOWN_OPTIONS[0]).toEqual({ value: 'format', label: 'Format' })
  })

  it('returns all source buckets for the source dimension', () => {
    const series = getBreakdownSeries('source', 'theme:violet', [])
    expect(series.map((s) => s.key)).toEqual(['bookorbit', 'ios', 'watchos', 'android', 'koreader', 'kobo'])
    expect(series.map((s) => s.label)).toEqual(['BookOrbit', 'iOS app', 'Apple Watch', 'Android app', 'KOReader', 'Kobo'])
  })

  it('returns one series per format key for the format dimension', () => {
    expect(getBreakdownSeries('format', 'theme:violet', ['EPUB', 'PDF'])).toEqual([
      { key: 'EPUB', label: 'EPUB', color: '#16a34a' },
      { key: 'PDF', label: 'PDF', color: '#dc2626' },
    ])
  })

  it('resolves a per-item colour for each dimension', () => {
    expect(getBreakdownColor('format', 'EPUB', 'theme:violet')).toBe('#16a34a')
    expect(getBreakdownColor('source', 'koreader', 'theme:violet')).toBe('rgb(--pill-koreader)')
  })
})
