// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { metadataScoreColor } from '../metadata-score-color'

describe('metadataScoreColor', () => {
  it('lands on the ramp stops exactly', () => {
    expect(metadataScoreColor(0)).toBe('color-mix(in oklch, var(--score-orange) 0.00%, var(--score-red))')
    expect(metadataScoreColor(35)).toBe('color-mix(in oklch, var(--score-orange) 100.00%, var(--score-red))')
    expect(metadataScoreColor(65)).toBe('color-mix(in oklch, var(--score-yellow) 100.00%, var(--score-orange))')
    expect(metadataScoreColor(100)).toBe('color-mix(in oklch, var(--score-green) 100.00%, var(--score-yellow))')
  })

  it('interpolates between the stops that bracket the score', () => {
    expect(metadataScoreColor(17.5)).toBe('color-mix(in oklch, var(--score-orange) 50.00%, var(--score-red))')
    expect(metadataScoreColor(50)).toBe('color-mix(in oklch, var(--score-yellow) 50.00%, var(--score-orange))')
    expect(metadataScoreColor(83)).toBe('color-mix(in oklch, var(--score-green) 51.43%, var(--score-yellow))')
  })

  it('clamps scores outside 0-100 to the ends of the ramp', () => {
    expect(metadataScoreColor(-40)).toBe(metadataScoreColor(0))
    expect(metadataScoreColor(140)).toBe(metadataScoreColor(100))
  })
})
