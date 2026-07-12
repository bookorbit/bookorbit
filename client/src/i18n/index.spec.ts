import { describe, expect, it } from 'vitest'
import { slovenianPluralRule } from './index'

describe('slovenianPluralRule', () => {
  it.each([
    [1, 0],
    [2, 1],
    [3, 2],
    [4, 2],
    [5, 3],
    [11, 3],
    [101, 0],
    [102, 1],
    [103, 2],
    [104, 2],
    [100, 3],
    [1.5, 2],
    [101.01, 2],
  ])('selects the Slovenian category for %i', (choice, expected) => {
    expect(slovenianPluralRule(choice, 4)).toBe(expected)
  })

  it('maps legacy three-branch messages without selecting a missing branch', () => {
    expect(slovenianPluralRule(1, 3)).toBe(0)
    expect(slovenianPluralRule(2, 3)).toBe(1)
    expect(slovenianPluralRule(3, 3)).toBe(2)
    expect(slovenianPluralRule(5, 3)).toBe(2)
  })
})
