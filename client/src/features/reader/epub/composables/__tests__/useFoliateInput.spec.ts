import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFoliateInput } from '../useFoliateInput'

interface ViewLike {
  prev: () => void
  next: () => void
  getBoundingClientRect: () => DOMRect
}

type DocTarget = EventTarget & Document

function makeDocTarget(): DocTarget {
  const target = new EventTarget() as DocTarget
  const frameElement = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect,
  } as HTMLIFrameElement

  Object.defineProperty(target, 'defaultView', {
    configurable: true,
    value: {
      frameElement,
      getSelection: () => null,
    },
  })

  return target
}

describe('useFoliateInput', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('navigates with document keyboard shortcuts', () => {
    const prev = vi.fn<() => void>()
    const next = vi.fn<() => void>()
    const view: ViewLike = {
      prev,
      next,
      getBoundingClientRect: () => ({ left: 0, width: 100 }) as DOMRect,
    }

    const input = useFoliateInput(() => view, undefined, vi.fn<() => void>(), vi.fn<() => void>())

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', shiftKey: true, bubbles: true }))

    expect(prev).toHaveBeenCalledTimes(2)
    expect(next).toHaveBeenCalledTimes(2)

    input.cleanup()
  })

  it('ignores keyboard navigation while typing in editable inputs', () => {
    const prev = vi.fn<() => void>()
    const next = vi.fn<() => void>()
    const view: ViewLike = {
      prev,
      next,
      getBoundingClientRect: () => ({ left: 0, width: 100 }) as DOMRect,
    }

    const input = useFoliateInput(() => view, undefined, vi.fn<() => void>(), vi.fn<() => void>())

    const textInput = document.createElement('input')
    document.body.appendChild(textInput)

    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
    textInput.dispatchEvent(event)

    expect(next).not.toHaveBeenCalled()
    expect(prev).not.toHaveBeenCalled()

    textInput.remove()
    input.cleanup()
  })

  it('handles keyboard navigation from iframe document after attachIframeClicks', () => {
    const prev = vi.fn<() => void>()
    const next = vi.fn<() => void>()
    const view: ViewLike = {
      prev,
      next,
      getBoundingClientRect: () => ({ left: 0, width: 100 }) as DOMRect,
    }

    const input = useFoliateInput(() => view, undefined, vi.fn<() => void>(), vi.fn<() => void>())
    const doc = makeDocTarget()

    input.attachIframeClicks(doc)

    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }))
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }))

    expect(next).toHaveBeenCalledTimes(1)
    expect(prev).toHaveBeenCalledTimes(1)

    input.cleanup()
  })

  it('routes click-zone window messages to prev/next/middle actions', () => {
    vi.useFakeTimers()

    const prev = vi.fn<() => void>()
    const next = vi.fn<() => void>()
    const onMiddleTap = vi.fn<() => void>()
    const view: ViewLike = {
      prev,
      next,
      getBoundingClientRect: () => ({ left: 0, width: 100 }) as DOMRect,
    }

    const input = useFoliateInput(() => view, onMiddleTap, vi.fn<() => void>(), vi.fn<() => void>())
    const doc = makeDocTarget()
    input.attachIframeClicks(doc)

    const originalMaxTouchPoints = Object.getOwnPropertyDescriptor(navigator, 'maxTouchPoints')
    const originalOntouchstart = Object.getOwnPropertyDescriptor(window, 'ontouchstart')
    Object.defineProperty(navigator, 'maxTouchPoints', {
      configurable: true,
      get: () => 0,
    })
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'ontouchstart')

    doc.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'foliate-click', clientX: 5 } }))
    vi.advanceTimersByTime(300)
    expect(prev).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(300)

    doc.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'foliate-click', clientX: 95 } }))
    vi.advanceTimersByTime(300)
    expect(next).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(300)

    doc.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'foliate-click', clientX: 50 } }))
    vi.advanceTimersByTime(300)
    expect(onMiddleTap).toHaveBeenCalledTimes(1)

    input.cleanup()

    if (originalMaxTouchPoints) {
      Object.defineProperty(navigator, 'maxTouchPoints', originalMaxTouchPoints)
    }
    if (originalOntouchstart) {
      Object.defineProperty(window, 'ontouchstart', originalOntouchstart)
    }
  })

  it('stops responding to document keydown after cleanup', () => {
    const next = vi.fn<() => void>()
    const view: ViewLike = {
      prev: vi.fn<() => void>(),
      next,
      getBoundingClientRect: () => ({ left: 0, width: 100 }) as DOMRect,
    }

    const input = useFoliateInput(() => view, undefined, vi.fn<() => void>(), vi.fn<() => void>())
    input.cleanup()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(next).not.toHaveBeenCalled()
  })
})
