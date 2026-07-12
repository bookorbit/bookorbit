import { describe, expect, it } from 'vitest'
import { Rotation, type PdfPageObjectWithRotatedSize } from '@embedpdf/models'
import type { PageVisibilityMetrics } from '@embedpdf/plugin-scroll'
import { canTurnFromVisiblePage, findAdjacentPage, findPageRange, shouldUseResponsiveSpread } from '../pdf-pagination'

function page(index: number, width = 600, height = 800): PdfPageObjectWithRotatedSize {
  return {
    index,
    size: { width, height },
    rotatedSize: { width, height },
    rotation: Rotation.Degree0,
    objectNumber: index + 1,
  }
}

function visibility(pageNumber: number, pageX: number, pageY: number, visibleWidth: number, visibleHeight: number): PageVisibilityMetrics {
  return {
    pageNumber,
    viewportX: 0,
    viewportY: 0,
    visiblePercentage: 100,
    original: { pageX, pageY, visibleWidth, visibleHeight, scale: 1 },
    scaled: { pageX, pageY, visibleWidth, visibleHeight, scale: 1 },
  }
}

describe('PDF pagination helpers', () => {
  const spreads = [[page(0)], [page(1), page(2)], [page(3), page(4)]]

  it('finds the visible logical spread for any page in it', () => {
    expect(findPageRange(spreads, 3, 5)).toEqual({ start: 2, end: 3 })
    expect(findPageRange(spreads, 5, 5)).toEqual({ start: 4, end: 5 })
  })

  it('moves by logical spreads and stops at document boundaries', () => {
    expect(findAdjacentPage(spreads, 1, 1, 5)).toBe(2)
    expect(findAdjacentPage(spreads, 2, 1, 5)).toBe(4)
    expect(findAdjacentPage(spreads, 4, 1, 5)).toBe(4)
    expect(findAdjacentPage(spreads, 1, -1, 5)).toBe(1)
  })

  it('requires an enlarged page to reach the relevant pan boundary before turning', () => {
    const range = { start: 1, end: 1 }
    expect(canTurnFromVisiblePage(1, range, [visibility(1, 0, 100, 600, 600)], spreads)).toBe(false)
    expect(canTurnFromVisiblePage(1, range, [visibility(1, 0, 200, 600, 600)], spreads)).toBe(true)
    expect(canTurnFromVisiblePage(1, range, [visibility(1, 100, 0, 500, 800)], spreads, 'horizontal')).toBe(true)
    expect(canTurnFromVisiblePage(-1, range, [visibility(1, 20, 0, 500, 800)], spreads, 'horizontal')).toBe(false)
  })

  it('uses responsive spreads only for sufficiently wide landscape viewports', () => {
    expect(shouldUseResponsiveSpread(1200, 800)).toBe(true)
    expect(shouldUseResponsiveSpread(800, 1200)).toBe(false)
    expect(shouldUseResponsiveSpread(850, 700)).toBe(false)
  })
})
