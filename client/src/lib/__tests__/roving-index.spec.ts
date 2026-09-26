// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { nextRovingIndex } from '../roving-index'

describe('nextRovingIndex', () => {
  it('moves forward and back, wrapping at both ends', () => {
    expect(nextRovingIndex('ArrowRight', 0, 2)).toBe(1)
    expect(nextRovingIndex('ArrowDown', 1, 2)).toBe(0)
    expect(nextRovingIndex('ArrowLeft', 0, 2)).toBe(1)
    expect(nextRovingIndex('ArrowUp', 1, 3)).toBe(0)
  })

  it('jumps to the ends', () => {
    expect(nextRovingIndex('Home', 2, 3)).toBe(0)
    expect(nextRovingIndex('End', 0, 3)).toBe(2)
  })

  it('treats an unselected group as starting from the first item', () => {
    expect(nextRovingIndex('ArrowRight', -1, 3)).toBe(1)
  })

  it('ignores other keys and empty groups', () => {
    expect(nextRovingIndex('Enter', 0, 2)).toBeNull()
    expect(nextRovingIndex('ArrowRight', 0, 0)).toBeNull()
  })
})
