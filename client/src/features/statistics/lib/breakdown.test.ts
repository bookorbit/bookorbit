import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/echarts', () => ({
  readCssColor: (varName: string) => `rgb(${varName})`,
  oklchToHex: () => '#000000',
}))

import { getBreakdownColor, getBreakdownSeries } from './breakdown'

describe('breakdown', () => {
  it('returns the three source buckets for the source dimension', () => {
    const series = getBreakdownSeries('source', 'theme:violet', [])
    expect(series.map((s) => s.key)).toEqual(['bookorbit', 'koreader', 'kobo'])
    expect(series.map((s) => s.label)).toEqual(['BookOrbit', 'KOReader', 'Kobo'])
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
