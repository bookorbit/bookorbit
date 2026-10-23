import { describe, expect, it } from 'vitest'
import { oklchToHex, toLegacyColor } from './css-color'
import { buildChartTheme, createChartTokens } from './echarts'

function isHexColor(v: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(v)
}

const TOKENS: Record<string, string> = {
  '--primary': 'oklch(0.62 0.19 259)',
  '--border': 'oklch(1 0 0 / 0.1)',
  '--muted-foreground': 'oklch(0.725 0.001 80)',
  '--foreground': 'oklch(0.985 0.001 80)',
  '--popover': 'oklch(0.18 0.0175 80)',
  '--popover-foreground': 'oklch(0.985 0.001 80)',
}

function read(varName: string): string {
  return TOKENS[varName] ?? ''
}

describe('createChartTokens', () => {
  it('derives a 10-colour hex palette from the live primary', () => {
    const tokens = createChartTokens('dark:blue', true, read)
    const palette = tokens.palette()
    expect(palette).toHaveLength(10)
    expect(palette.every(isHexColor)).toBe(true)
    expect(palette[0]).toBe(oklchToHex(0.62, 0.19, 259))
  })

  it('scales chroma and lightness', () => {
    const tokens = createChartTokens('dark:blue', true, read)
    expect(tokens.palette(0.5, 0.5)[0]).toBe(oklchToHex(0.31, 0.095, 259))
  })

  it('memoises token reads for its key', () => {
    let reads = 0
    const tokens = createChartTokens('k', false, (name) => {
      reads += 1
      return read(name)
    })
    tokens.color('--border')
    tokens.color('--border')
    expect(reads).toBe(1)
  })
})

describe('buildChartTheme', () => {
  it('paints axes, legend and tooltip from tokens', () => {
    const theme = buildChartTheme(createChartTokens('dark:blue', true, read))
    expect(theme.categoryAxis.axisLine.lineStyle.color).toBe('rgba(255, 255, 255, 0.1)')
    expect(theme.valueAxis.axisLabel.color).toBe(toLegacyColor(TOKENS['--muted-foreground']!))
    expect(theme.legend.textStyle.color).toBe(toLegacyColor(TOKENS['--foreground']!))
    expect(theme.tooltip.backgroundColor).toBe(toLegacyColor(TOKENS['--popover']!))
    expect(theme.color).toHaveLength(10)
  })
})
