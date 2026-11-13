import { describe, expect, it } from 'vitest'
import { shouldUseResponsiveSpread, toPageRange } from '../pdf-pagination'

describe('PDF pagination helpers', () => {
  it('turns the 0-based pages on screen into a 1-based range', () => {
    expect(toPageRange([1, 2], 2, 5)).toEqual({ start: 2, end: 3 })
    expect(toPageRange([4], 5, 5)).toEqual({ start: 5, end: 5 })
    expect(toPageRange([3, 2], 3, 5)).toEqual({ start: 3, end: 4 })
  })

  it('falls back to the current page, clamped to the document, before the Stage reports pages', () => {
    expect(toPageRange([], 3, 5)).toEqual({ start: 3, end: 3 })
    expect(toPageRange([], 9, 5)).toEqual({ start: 5, end: 5 })
    expect(toPageRange([], 0, 0)).toEqual({ start: 1, end: 1 })
  })

  it('uses responsive spreads only for sufficiently wide landscape viewports', () => {
    expect(shouldUseResponsiveSpread(1200, 800)).toBe(true)
    expect(shouldUseResponsiveSpread(800, 1200)).toBe(false)
    expect(shouldUseResponsiveSpread(850, 700)).toBe(false)
  })
})
