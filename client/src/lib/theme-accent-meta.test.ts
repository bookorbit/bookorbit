import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ACCENT_IDS, type Accent } from '@bookorbit/types'
import {
  ACCENT_HUE,
  ACCENT_OPTIONS,
  ACCENT_PAIRS,
  ACCENT_PASTEL,
  ACCENT_PRIMARY,
  ACCENT_ROWS,
  ACCENT_VIVID,
  DEFAULT_ACCENT,
  isPastelAccent,
  resolveAccent,
} from './theme-accent-meta'

const accentsCss = readFileSync(resolve(process.cwd(), 'src/assets/theme/accents.css'), 'utf8')

describe('resolveAccent', () => {
  it('returns default accent for nullish or invalid values', () => {
    expect(resolveAccent(undefined)).toBe(DEFAULT_ACCENT)
    expect(resolveAccent(null)).toBe(DEFAULT_ACCENT)
    expect(resolveAccent('')).toBe(DEFAULT_ACCENT)
    expect(resolveAccent('not-a-real-accent')).toBe(DEFAULT_ACCENT)
  })

  it('returns valid accent values unchanged', () => {
    expect(resolveAccent('blue')).toBe('blue')
    expect(resolveAccent('mint')).toBe('mint')
  })
})

describe('isPastelAccent', () => {
  it('classifies accent tone correctly', () => {
    expect(isPastelAccent('mint')).toBe(true)
    expect(isPastelAccent('blue')).toBe(false)
    expect(isPastelAccent('unknown')).toBe(false)
  })
})

describe('accent option collections', () => {
  it('contains every accent id exactly once across all options', () => {
    const ids = ACCENT_OPTIONS.map((opt) => opt.id)
    expect(ids.length).toBe(ACCENT_IDS.length)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(ids)).toEqual(new Set(ACCENT_IDS))
  })

  it('partitions vivid and pastel options without overlap', () => {
    const vividIds = new Set(ACCENT_VIVID.map((opt) => opt.id))
    const pastelIds = new Set(ACCENT_PASTEL.map((opt) => opt.id))
    const overlap = [...vividIds].filter((id) => pastelIds.has(id))
    expect(overlap).toHaveLength(0)
    expect(vividIds.size + pastelIds.size).toBe(ACCENT_IDS.length)
  })

  it('starts with white and orange, then wraps the red accents to the end', () => {
    expect(ACCENT_VIVID.map((option) => option.id)).toEqual([
      'white',
      'orange',
      'copper',
      'amber',
      'marigold',
      'yellow',
      'chartreuse',
      'acid-green',
      'lime',
      'wasabi',
      'green',
      'malachite',
      'jade',
      'emerald',
      'viridian',
      'teal',
      'turquoise',
      'cyan',
      'electric-blue',
      'ultramarine',
      'blue',
      'iris',
      'indigo',
      'purple',
      'violet',
      'amethyst',
      'fuchsia',
      'pink',
      'raspberry',
      'scarlet',
      'rose',
      'vermilion',
    ])
  })

  it('organizes each bright row directly above its pastel counterparts', () => {
    expect(ACCENT_PAIRS).toHaveLength(32)
    expect(ACCENT_ROWS).toHaveLength(4)
    expect(ACCENT_ROWS.every((row) => row.length === 16)).toBe(true)

    const firstGroup = ACCENT_PAIRS.slice(0, 16)
    const secondGroup = ACCENT_PAIRS.slice(16)
    expect(ACCENT_ROWS[0]).toEqual(firstGroup.map((pair) => pair.vivid))
    expect(ACCENT_ROWS[1]).toEqual(firstGroup.map((pair) => pair.pastel))
    expect(ACCENT_ROWS[2]).toEqual(secondGroup.map((pair) => pair.vivid))
    expect(ACCENT_ROWS[3]).toEqual(secondGroup.map((pair) => pair.pastel))

    for (const pair of ACCENT_PAIRS) {
      expect(ACCENT_HUE[pair.pastel.id]).toBe(ACCENT_HUE[pair.vivid.id])
    }

    for (const pair of ACCENT_PAIRS.slice(1)) {
      const [vividLightness, vividChroma, vividDarkLightness, vividDarkChroma] = ACCENT_PRIMARY[pair.vivid.id]
      const [pastelLightness, pastelChroma, pastelDarkLightness, pastelDarkChroma] = ACCENT_PRIMARY[pair.pastel.id]
      expect(pastelLightness).toBeGreaterThan(vividLightness)
      expect(pastelChroma).toBeLessThan(vividChroma)
      expect(pastelDarkLightness).toBeGreaterThan(vividDarkLightness)
      expect(pastelDarkChroma).toBeLessThan(vividDarkChroma)
    }
  })

  it('keeps the vivid palette saturated and in continuous rainbow order', () => {
    for (const option of ACCENT_VIVID.slice(1)) {
      const [, lightChroma, , darkChroma] = ACCENT_PRIMARY[option.id]
      expect(lightChroma).toBeGreaterThanOrEqual(0.16)
      expect(darkChroma).toBeGreaterThanOrEqual(0.14)
    }

    const unwrappedHues = ACCENT_VIVID.slice(1).map((option) => {
      const hue = ACCENT_HUE[option.id]
      return hue < ACCENT_HUE.orange ? hue + 360 : hue
    })
    expect(unwrappedHues).toEqual([...unwrappedHues].sort((a, b) => a - b))
  })

  it('keeps every pastel visibly related without washing it out', () => {
    for (const pair of ACCENT_PAIRS.slice(1)) {
      const [, vividChroma, , vividDarkChroma] = ACCENT_PRIMARY[pair.vivid.id]
      const [, pastelChroma, , pastelDarkChroma] = ACCENT_PRIMARY[pair.pastel.id]
      expect(pastelChroma / vividChroma).toBeGreaterThanOrEqual(0.45)
      expect(pastelChroma / vividChroma).toBeLessThanOrEqual(0.6)
      expect(pastelDarkChroma / vividDarkChroma).toBeGreaterThanOrEqual(0.45)
      expect(pastelDarkChroma / vividDarkChroma).toBeLessThanOrEqual(0.6)
    }
  })

  it('previews the applied primary color for light and dark themes', () => {
    for (const option of ACCENT_OPTIONS) {
      const [lightL, lightC, darkL, darkC] = ACCENT_PRIMARY[option.id]
      const hue = ACCENT_HUE[option.id]
      expect(option.color).toBe(`light-dark(oklch(${lightL} ${lightC} ${hue}), oklch(${darkL} ${darkC} ${hue}))`)
    }
  })
})

describe('accent metadata records', () => {
  it('defines hue and primary values for every accent', () => {
    for (const accent of ACCENT_IDS) {
      const hue = ACCENT_HUE[accent]
      const primary = ACCENT_PRIMARY[accent]
      expect(Number.isFinite(hue)).toBe(true)
      expect(primary).toHaveLength(4)
      expect(primary.every((v) => Number.isFinite(v))).toBe(true)
    }
  })

  it('primary tuples keep chroma non-negative in both modes', () => {
    for (const accent of ACCENT_IDS as readonly Accent[]) {
      const primary = ACCENT_PRIMARY[accent]
      expect(primary[1]).toBeGreaterThanOrEqual(0)
      expect(primary[3]).toBeGreaterThanOrEqual(0)
    }
  })

  it('matches the primary colors applied by every accent class', () => {
    for (const accent of ACCENT_IDS) {
      const [lightL, lightC, darkL, darkC] = ACCENT_PRIMARY[accent]
      const hue = ACCENT_HUE[accent]
      const lightSelector = `html.accent-${accent} {`
      const darkSelector = `html.accent-${accent}.dark {`
      const lightStart = accentsCss.indexOf(lightSelector)
      const darkStart = accentsCss.indexOf(darkSelector)
      const lightBlock = lightStart >= 0 ? accentsCss.slice(lightStart, accentsCss.indexOf('}', lightStart)) : undefined
      const darkBlock = darkStart >= 0 ? accentsCss.slice(darkStart, accentsCss.indexOf('}', darkStart)) : undefined

      expect(lightBlock, `missing light CSS block for ${accent}`).toBeDefined()
      expect(darkBlock, `missing dark CSS block for ${accent}`).toBeDefined()
      expect(lightBlock!).toContain(`--primary: oklch(${lightL} ${lightC} ${hue});`)
      expect(darkBlock!).toContain(`--primary: oklch(${darkL} ${darkC} ${hue});`)
    }
  })

  it('uses readable dark foreground text for every pastel theme', () => {
    for (const option of ACCENT_PASTEL) {
      for (const selector of [`html.accent-${option.id} {`, `html.accent-${option.id}.dark {`]) {
        const start = accentsCss.indexOf(selector)
        const block = accentsCss.slice(start, accentsCss.indexOf('}', start))
        expect(block).toContain('--primary-foreground: oklch(0.145 0 0);')
        expect(block).toContain('--sidebar-primary-foreground: oklch(0.145 0 0);')
      }
    }
  })
})
