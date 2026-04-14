import { describe, it, expect } from 'vitest'
import { bookCoverStyle, titleFontSizeClass } from './book-cover'

describe('bookCoverStyle', () => {
  it('returns background and color properties', () => {
    const style = bookCoverStyle('Dune')
    expect(style).toHaveProperty('background')
    expect(style).toHaveProperty('color')
  })

  it('produces oklch colors', () => {
    const style = bookCoverStyle('Test')
    expect(style.background).toMatch(/^oklch\(/)
    expect(style.color).toMatch(/^oklch\(/)
  })

  it('produces consistent results for the same seed', () => {
    const a = bookCoverStyle('Foundation')
    const b = bookCoverStyle('Foundation')
    expect(a).toEqual(b)
  })

  it('produces different colors for different seeds', () => {
    const a = bookCoverStyle('Dune')
    const b = bookCoverStyle('Foundation')
    expect(a.background).not.toBe(b.background)
  })

  it('handles empty string seed without throwing', () => {
    expect(() => bookCoverStyle('')).not.toThrow()
  })

  it('handles numeric fallback seed (e.g. book id as string)', () => {
    const style = bookCoverStyle('42')
    expect(style.background).toMatch(/^oklch\(/)
  })

  it('uses higher saturation than legacy values', () => {
    // Both light and dark variants should have chroma > 0.08 (old was 0.07)
    const style = bookCoverStyle('Test Seed')
    const chromaMatch = style.background.match(/oklch\([\d.]+\s+([\d.]+)/)
    expect(chromaMatch).not.toBeNull()
    const chroma = parseFloat(chromaMatch?.[1] ?? '0')
    expect(chroma).toBeGreaterThan(0.08)
  })

  it('produces a light variant for some seeds', () => {
    // A light variant has high lightness background (> 0.7)
    let foundLight = false
    for (let i = 0; i < 20; i++) {
      const style = bookCoverStyle(`seed-${i}`)
      const lightnessMatch = style.background.match(/oklch\(([\d.]+)/)
      if (lightnessMatch && parseFloat(lightnessMatch[1] ?? '0') > 0.7) {
        foundLight = true
        break
      }
    }
    expect(foundLight).toBe(true)
  })

  it('produces a dark variant for some seeds', () => {
    let foundDark = false
    for (let i = 0; i < 20; i++) {
      const style = bookCoverStyle(`seed-${i}`)
      const lightnessMatch = style.background.match(/oklch\(([\d.]+)/)
      if (lightnessMatch && parseFloat(lightnessMatch[1] ?? '1') < 0.5) {
        foundDark = true
        break
      }
    }
    expect(foundDark).toBe(true)
  })
})

describe('titleFontSizeClass', () => {
  it('returns largest class for very short titles', () => {
    expect(titleFontSizeClass('Dune')).toBe('text-[14cqi]')
  })

  it('returns large class for short titles (up to 8 chars)', () => {
    expect(titleFontSizeClass('12345678')).toBe('text-[14cqi]')
  })

  it('returns medium-large class for titles 9-16 chars', () => {
    expect(titleFontSizeClass('Foundation')).toBe('text-[11cqi]')
    expect(titleFontSizeClass('1234567890123456')).toBe('text-[11cqi]')
  })

  it('returns medium class for titles 17-30 chars', () => {
    expect(titleFontSizeClass('The Lord of the Rings')).toBe('text-[8cqi]')
  })

  it('returns small class for long titles over 30 chars', () => {
    expect(titleFontSizeClass("The Hitchhiker's Guide to the Galaxy")).toBe('text-[6cqi]')
  })

  it('handles empty string', () => {
    expect(titleFontSizeClass('')).toBe('text-[14cqi]')
  })
})
