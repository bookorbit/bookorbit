import { describe, expect, it } from 'vitest'
import { oklchToHex, parseOklch, toLegacyColor } from './css-color'

describe('parseOklch', () => {
  it('reads fractional and percentage components', () => {
    expect(parseOklch('oklch(0.72 0.14 245)')).toEqual({ l: 0.72, c: 0.14, h: 245, alpha: 1 })
    expect(parseOklch('oklch(72% 50% 245)')).toEqual({ l: 0.72, c: 0.2, h: 245, alpha: 1 })
  })

  it('reads the alpha after the slash and treats a missing hue as zero', () => {
    expect(parseOklch('oklch(1 0 none / 0.1)')).toEqual({ l: 1, c: 0, h: 0, alpha: 0.1 })
    expect(parseOklch('oklch(0.5 0.1 20 / 40%)')?.alpha).toBe(0.4)
  })

  it('rejects anything else', () => {
    expect(parseOklch('rgb(1, 2, 3)')).toBeNull()
    expect(parseOklch('oklch(not a color)')).toBeNull()
  })
})

describe('toLegacyColor', () => {
  it('passes rgb and hex through', () => {
    expect(toLegacyColor('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)')
    expect(toLegacyColor('#123456')).toBe('#123456')
  })

  it('hexes an opaque oklch colour', () => {
    expect(toLegacyColor('oklch(0.72 0.14 245)')).toBe(oklchToHex(0.72, 0.14, 245))
  })

  it('keeps translucency as rgba', () => {
    expect(toLegacyColor('oklch(1 0 0 / 0.1)')).toBe('rgba(255, 255, 255, 0.1)')
    expect(toLegacyColor('color(srgb 1 0 0 / 0.5)')).toBe('rgba(255, 0, 0, 0.5)')
  })

  it('returns an unparseable value unchanged', () => {
    expect(toLegacyColor('oklch(not a color)')).toBe('oklch(not a color)')
  })
})
