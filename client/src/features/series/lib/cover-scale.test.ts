import { describe, expect, it } from 'vitest'
import { centeredBottomScaleTransform, resolveSquareCoverScale, shouldPersistCoverRatio } from './cover-scale'

describe('cover-scale utilities', () => {
  it('persists a ratio only when it is valid and meaningfully changed', () => {
    expect(shouldPersistCoverRatio(undefined, null)).toBe(false)
    expect(shouldPersistCoverRatio(undefined, 0)).toBe(false)
    expect(shouldPersistCoverRatio(undefined, 1)).toBe(true)
    expect(shouldPersistCoverRatio(1, 1.00001)).toBe(false)
    expect(shouldPersistCoverRatio(1, 1.01)).toBe(true)
  })

  it('detects square covers using tolerance and returns the enlarged scale', () => {
    expect(resolveSquareCoverScale(null, 1.25)).toBe(1)
    expect(resolveSquareCoverScale(0.66, 1.25)).toBe(1)
    expect(resolveSquareCoverScale(0.93, 1.25)).toBe(1.25)
    expect(resolveSquareCoverScale(1.07, 1.25)).toBe(1.25)
  })

  it('returns centered bottom transform only when scale exceeds 1', () => {
    expect(centeredBottomScaleTransform(1)).toBeNull()
    expect(centeredBottomScaleTransform(Number.NaN)).toBeNull()
    expect(centeredBottomScaleTransform(1.25)).toEqual({
      transformOrigin: 'center bottom',
      transform: 'translateY(-12.5%) scale(1.25)',
    })
  })
})
