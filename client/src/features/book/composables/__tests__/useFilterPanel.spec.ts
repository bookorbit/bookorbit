import { afterEach, describe, expect, it } from 'vitest'
import { useFilterPanel } from '../useFilterPanel'

function rect(x: number): DOMRect {
  return { x, y: 10, top: 10, left: x, right: x + 40, bottom: 34, width: 40, height: 24, toJSON: () => ({}) }
}

function tokenAt(x: number): { element: HTMLElement; moveTo: (next: number) => void } {
  const element = document.createElement('span')
  let current = rect(x)
  element.getBoundingClientRect = () => current
  document.body.appendChild(element)
  return {
    element,
    moveTo(next: number) {
      current = rect(next)
    },
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('useFilterPanel', () => {
  it("opens on a token's rule under the token, and the Filters button always reopens the field list under itself", () => {
    const panel = useFilterPanel()
    const { element } = tokenAt(120)

    panel.openRule(2, element)
    expect(panel.open.value).toBe(true)
    expect(panel.view.value).toEqual({ kind: 'rule', index: 2 })
    expect(panel.anchor.value?.getBoundingClientRect().left).toBe(120)

    panel.close()
    panel.setOpen(true)
    expect(panel.view.value).toEqual({ kind: 'fields' })
    expect(panel.anchor.value).toBeNull()
  })

  it('follows the token while it is on the page and stays where it last was once it leaves', () => {
    const panel = useFilterPanel()
    const token = tokenAt(120)
    panel.openRule(0, token.element)

    token.moveTo(160)
    expect(panel.anchor.value?.getBoundingClientRect().left).toBe(160)

    token.element.remove()
    token.moveTo(0)
    expect(panel.anchor.value?.getBoundingClientRect().left).toBe(160)
  })

  it('leaves the view alone when the button closes an open panel', () => {
    const panel = useFilterPanel()
    panel.openBuilder()

    panel.setOpen(false)

    expect(panel.open.value).toBe(false)
    expect(panel.view.value).toEqual({ kind: 'builder' })
  })
})
