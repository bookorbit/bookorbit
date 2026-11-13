import { describe, expect, it } from 'vitest'
import { calculateFoldGeometry, getCornerPoint } from '../utils/conical-fold'

describe('conical-fold math', () => {
  it('correctly calculates corner points', () => {
    expect(getCornerPoint('bottom-right', 800, 1000)).toEqual({ x: 800, y: 1000 })
    expect(getCornerPoint('top-right', 800, 1000)).toEqual({ x: 800, y: 0 })
    expect(getCornerPoint('bottom-left', 800, 1000)).toEqual({ x: 0, y: 1000 })
    expect(getCornerPoint('top-left', 800, 1000)).toEqual({ x: 0, y: 0 })
  })

  it('calculates fold geometry when pulling bottom-right corner', () => {
    const geom = calculateFoldGeometry(800, 1000, 'bottom-right', { x: 600, y: 900 })
    expect(geom).not.toBeNull()
    if (!geom) return

    expect(geom.active).toBe(true)
    expect(geom.corner).toBe('bottom-right')
    expect(geom.foldLine.length).toBe(2)
    expect(geom.peelPolygon.length).toBeGreaterThanOrEqual(3)
    expect(geom.reflectedPolygon.length).toBeGreaterThanOrEqual(3)
  })

  it('returns null when touch is at corner', () => {
    const geom = calculateFoldGeometry(800, 1000, 'bottom-right', { x: 800, y: 1000 })
    expect(geom).toBeNull()
  })
})
