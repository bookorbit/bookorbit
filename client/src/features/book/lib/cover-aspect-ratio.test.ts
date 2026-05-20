import { describe, expect, it } from 'vitest'
import { coverAspectRatioValue, fittedCoverFrameStyle } from './cover-aspect-ratio'

describe('coverAspectRatioValue', () => {
  it('parses a valid ratio string', () => {
    expect(coverAspectRatioValue('1/1')).toBe(1)
    expect(coverAspectRatioValue('2/3')).toBeCloseTo(2 / 3, 5)
  })

  it('falls back to default when input is invalid', () => {
    expect(coverAspectRatioValue('bad')).toBeCloseTo(2 / 3, 5)
    expect(coverAspectRatioValue('2/0')).toBeCloseTo(2 / 3, 5)
    expect(coverAspectRatioValue('2/')).toBeCloseTo(2 / 3, 5)
  })
})

describe('fittedCoverFrameStyle', () => {
  it('returns full inset when image ratio or slot ratio is invalid', () => {
    expect(fittedCoverFrameStyle(null, 2 / 3)).toEqual({ inset: '0' })
    expect(fittedCoverFrameStyle(1, 0)).toEqual({ inset: '0' })
  })

  it('returns full inset when ratios match', () => {
    expect(fittedCoverFrameStyle(2 / 3, 2 / 3)).toEqual({ inset: '0' })
  })

  it('fits by height when image is wider than slot', () => {
    const style = fittedCoverFrameStyle(1, 2 / 3)
    expect(style.width).toBe('100%')
    expect(style.top).toBe('50%')
    expect(style.left).toBe('0')
    expect(style.transform).toBe('translateY(-50%)')
    expect(parseFloat(style.height ?? '0')).toBeCloseTo(66.6667, 2)
  })

  it('fits by width when image is narrower than slot', () => {
    const style = fittedCoverFrameStyle(0.5, 2 / 3)
    expect(style.height).toBe('100%')
    expect(style.top).toBe('0')
    expect(style.left).toBe('50%')
    expect(style.transform).toBe('translateX(-50%)')
    expect(parseFloat(style.width ?? '0')).toBeCloseTo(75, 2)
  })
})
