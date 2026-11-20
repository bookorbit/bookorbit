import { describe, expect, it } from 'vitest'
import { isModifiedClick, isNewTabClick } from '../click-modifiers'

function click(init: MouseEventInit = {}): MouseEvent {
  return new MouseEvent('click', { button: 0, ...init })
}

describe('isModifiedClick', () => {
  it('treats a plain primary click as unmodified', () => {
    expect(isModifiedClick(click())).toBe(false)
  })

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])('treats %o as modified', (init) => {
    expect(isModifiedClick(click(init))).toBe(true)
  })
})

describe('isNewTabClick', () => {
  it('is false for a plain click', () => {
    expect(isNewTabClick(click())).toBe(false)
  })

  it.each([{ ctrlKey: true }, { metaKey: true }, { button: 1 }])('is true for %o', (init) => {
    expect(isNewTabClick(click(init))).toBe(true)
  })

  it.each([{ shiftKey: true }, { altKey: true }, { ctrlKey: true, shiftKey: true }, { button: 2 }])('is false for %o', (init) => {
    expect(isNewTabClick(click(init))).toBe(false)
  })
})
