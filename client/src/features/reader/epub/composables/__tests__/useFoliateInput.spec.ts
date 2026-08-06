import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFoliateInput } from '../useFoliateInput'

interface ViewLike {
  prev: () => void
  next: () => void
  goLeft?: () => void
  goRight?: () => void
  getBoundingClientRect: () => DOMRect
  renderer?: {
    getAttribute: (name: string) => string | null
  }
}

type DocTarget = EventTarget & Document

function makeDocTarget(selection: Selection | null = null): DocTarget {
  const target = new EventTarget() as DocTarget
  const frameElement = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect,
  } as HTMLIFrameElement

  Object.defineProperty(target, 'defaultView', {
    configurable: true,
    value: {
      frameElement,
      getSelection: () => selection,
    },
  })

  return target
}

interface TouchLike {
  clientX: number
  clientY: number
  screenX?: number
  screenY?: number
}

function withScreenCoords(touches: TouchLike[]) {
  return touches.map((touch) => ({
    ...touch,
    screenX: touch.screenX ?? touch.clientX,
    screenY: touch.screenY ?? touch.clientY,
  }))
}

function makeTouchEvent(type: string, touches: TouchLike[], changedTouches = touches): TouchEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent
  Object.defineProperties(event, {
    touches: { value: withScreenCoords(touches) },
    changedTouches: { value: withScreenCoords(changedTouches) },
  })
  return event
}

describe('useFoliateInput', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps document keyboard shortcuts active in scrolled flow', () => {
    const prev = vi.fn<() => void>()
    const next = vi.fn<() => void>()
    const view: ViewLike = {
      prev,
      next,
      getBoundingClientRect: () => ({ left: 0, width: 100 }) as DOMRect,
      renderer: { getAttribute: (name) => (name === 'flow' ? 'scrolled' : null) },
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

  it('preserves native touch gestures while adjusting an active text selection', () => {
    vi.useFakeTimers()

    const handleSelectionEnd = vi.fn<() => void>()
    const selection = {
      isCollapsed: false,
      rangeCount: 1,
    } as Selection
    const input = useFoliateInput(() => null, undefined, handleSelectionEnd, vi.fn<() => void>())
    const doc = makeDocTarget(selection)
    input.attachIframeClicks(doc)

    doc.dispatchEvent(makeTouchEvent('touchstart', [{ clientX: 20, clientY: 30 }]))
    const move = makeTouchEvent('touchmove', [{ clientX: 30, clientY: 40 }])
    const end = makeTouchEvent('touchend', [], [{ clientX: 30, clientY: 40 }])

    doc.dispatchEvent(move)
    doc.dispatchEvent(end)
    vi.advanceTimersByTime(50)

    expect(move.defaultPrevented).toBe(false)
    expect(end.defaultPrevented).toBe(false)
    expect(handleSelectionEnd).toHaveBeenCalledWith(doc)

    input.cleanup()
  })

  it.each([
    { endX: 40, expectedDirection: 'right' },
    { endX: 160, expectedDirection: 'left' },
  ])('navigates $expectedDirection for horizontal swipes in paginated flow', ({ endX, expectedDirection }) => {
    const goLeft = vi.fn<() => void>()
    const goRight = vi.fn<() => void>()
    const view: ViewLike = {
      prev: vi.fn<() => void>(),
      next: vi.fn<() => void>(),
      goLeft,
      goRight,
      getBoundingClientRect: () => ({ left: 0, width: 100 }) as DOMRect,
      renderer: { getAttribute: (name) => (name === 'flow' ? 'paginated' : null) },
    }
    const input = useFoliateInput(() => view, undefined, vi.fn<() => void>(), vi.fn<() => void>())
    const doc = makeDocTarget()
    input.attachIframeClicks(doc)

    doc.dispatchEvent(makeTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]))
    doc.dispatchEvent(makeTouchEvent('touchmove', [{ clientX: endX, clientY: 110 }]))
    doc.dispatchEvent(makeTouchEvent('touchend', [], [{ clientX: endX, clientY: 110 }]))

    expect(goLeft).toHaveBeenCalledTimes(expectedDirection === 'left' ? 1 : 0)
    expect(goRight).toHaveBeenCalledTimes(expectedDirection === 'right' ? 1 : 0)

    input.cleanup()
  })

  it.each([
    { endX: 40, direction: 'right' },
    { endX: 160, direction: 'left' },
  ])('preserves native scrolling for $direction horizontal movement in scrolled flow', ({ endX }) => {
    const prev = vi.fn<() => void>()
    const next = vi.fn<() => void>()
    const goLeft = vi.fn<() => void>()
    const goRight = vi.fn<() => void>()
    const view: ViewLike = {
      prev,
      next,
      goLeft,
      goRight,
      getBoundingClientRect: () => ({ left: 0, width: 100 }) as DOMRect,
      renderer: { getAttribute: (name) => (name === 'flow' ? 'scrolled' : null) },
    }
    const input = useFoliateInput(() => view, undefined, vi.fn<() => void>(), vi.fn<() => void>())
    const doc = makeDocTarget()
    input.attachIframeClicks(doc)

    doc.dispatchEvent(makeTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]))
    doc.dispatchEvent(makeTouchEvent('touchmove', [{ clientX: endX, clientY: 140 }]))
    doc.dispatchEvent(makeTouchEvent('touchend', [], [{ clientX: endX, clientY: 140 }]))

    expect(prev).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
    expect(goLeft).not.toHaveBeenCalled()
    expect(goRight).not.toHaveBeenCalled()

    input.cleanup()
  })

  it.each([
    { endX: 149, endY: 100, gesture: 'below the swipe threshold' },
    { endX: 160, endY: 170, gesture: 'predominantly vertical' },
  ])('does not navigate for a gesture $gesture in paginated flow', ({ endX, endY }) => {
    const prev = vi.fn<() => void>()
    const next = vi.fn<() => void>()
    const goLeft = vi.fn<() => void>()
    const goRight = vi.fn<() => void>()
    const view: ViewLike = {
      prev,
      next,
      goLeft,
      goRight,
      getBoundingClientRect: () => ({ left: 0, width: 100 }) as DOMRect,
      renderer: { getAttribute: (name) => (name === 'flow' ? 'paginated' : null) },
    }
    const input = useFoliateInput(() => view, undefined, vi.fn<() => void>(), vi.fn<() => void>())
    const doc = makeDocTarget()
    input.attachIframeClicks(doc)

    doc.dispatchEvent(makeTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]))
    doc.dispatchEvent(makeTouchEvent('touchmove', [{ clientX: endX, clientY: endY }]))
    doc.dispatchEvent(makeTouchEvent('touchend', [], [{ clientX: endX, clientY: endY }]))

    expect(prev).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
    expect(goLeft).not.toHaveBeenCalled()
    expect(goRight).not.toHaveBeenCalled()

    input.cleanup()
  })

  it('ignores a scrolling flick whose touch point stays put in the scrolled document', () => {
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const view: ViewLike = {
      prev: vi.fn<() => void>(),
      next: vi.fn<() => void>(),
      getBoundingClientRect: () => ({ left: 0, width: 100 }) as DOMRect,
      renderer: { getAttribute: (name) => (name === 'flow' ? 'scrolled' : null) },
    }
    const input = useFoliateInput(() => view, vi.fn<() => void>(), vi.fn<() => void>(), vi.fn<() => void>())
    const doc = makeDocTarget()
    input.attachIframeClicks(doc)

    doc.dispatchEvent(makeTouchEvent('touchstart', [{ clientX: 50, clientY: 50, screenX: 50, screenY: 150 }]))
    doc.dispatchEvent(makeTouchEvent('touchend', [], [{ clientX: 50, clientY: 50, screenX: 50, screenY: 50 }]))

    expect(postMessage).not.toHaveBeenCalled()

    postMessage.mockRestore()
    input.cleanup()
  })

  it('reports a stationary touch as a tap', () => {
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const view: ViewLike = {
      prev: vi.fn<() => void>(),
      next: vi.fn<() => void>(),
      getBoundingClientRect: () => ({ left: 0, width: 100 }) as DOMRect,
      renderer: { getAttribute: (name) => (name === 'flow' ? 'scrolled' : null) },
    }
    const input = useFoliateInput(() => view, vi.fn<() => void>(), vi.fn<() => void>(), vi.fn<() => void>())
    const doc = makeDocTarget()
    input.attachIframeClicks(doc)

    doc.dispatchEvent(makeTouchEvent('touchstart', [{ clientX: 50, clientY: 50 }]))
    doc.dispatchEvent(makeTouchEvent('touchend', [], [{ clientX: 50, clientY: 50 }]))

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'foliate-click' }), window.location.origin)

    postMessage.mockRestore()
    input.cleanup()
  })

  it('uses physical left and right helpers for arrow keys when available', () => {
    const prev = vi.fn<() => void>()
    const next = vi.fn<() => void>()
    const goLeft = vi.fn<() => void>()
    const goRight = vi.fn<() => void>()
    const view: ViewLike = {
      prev,
      next,
      goLeft,
      goRight,
      getBoundingClientRect: () => ({ left: 0, width: 100 }) as DOMRect,
    }

    const input = useFoliateInput(() => view, undefined, vi.fn<() => void>(), vi.fn<() => void>())

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }))

    expect(goLeft).toHaveBeenCalledTimes(1)
    expect(goRight).toHaveBeenCalledTimes(1)
    expect(prev).toHaveBeenCalledTimes(1)
    expect(next).toHaveBeenCalledTimes(1)

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

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'foliate-click', clientX: 5 }, origin: window.location.origin }))
    vi.advanceTimersByTime(300)
    expect(prev).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(300)

    doc.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'foliate-click', clientX: 95 }, origin: window.location.origin }))
    vi.advanceTimersByTime(300)
    expect(next).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(300)

    doc.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'foliate-click', clientX: 50 }, origin: window.location.origin }))
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

  it('routes click-zone window messages through physical left and right helpers when available', () => {
    vi.useFakeTimers()

    const prev = vi.fn<() => void>()
    const next = vi.fn<() => void>()
    const goLeft = vi.fn<() => void>()
    const goRight = vi.fn<() => void>()
    const onMiddleTap = vi.fn<() => void>()
    const view: ViewLike = {
      prev,
      next,
      goLeft,
      goRight,
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
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'foliate-click', clientX: 5 }, origin: window.location.origin }))
    vi.advanceTimersByTime(300)

    vi.advanceTimersByTime(300)
    doc.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'foliate-click', clientX: 95 }, origin: window.location.origin }))
    vi.advanceTimersByTime(300)

    expect(goLeft).toHaveBeenCalledTimes(1)
    expect(goRight).toHaveBeenCalledTimes(1)
    expect(prev).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()

    input.cleanup()

    if (originalMaxTouchPoints) {
      Object.defineProperty(navigator, 'maxTouchPoints', originalMaxTouchPoints)
    }
    if (originalOntouchstart) {
      Object.defineProperty(window, 'ontouchstart', originalOntouchstart)
    }
  })

  it('ignores a page-turn click message that arrives after annotation tap suppression starts', () => {
    vi.useFakeTimers()

    const next = vi.fn<() => void>()
    const onMiddleTap = vi.fn<() => void>()
    const view: ViewLike = {
      prev: vi.fn<() => void>(),
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
    input.suppressNextTapNavigation()
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'foliate-click', clientX: 95 }, origin: window.location.origin }))
    vi.advanceTimersByTime(500)

    expect(next).not.toHaveBeenCalled()
    expect(onMiddleTap).not.toHaveBeenCalled()

    input.cleanup()

    if (originalMaxTouchPoints) {
      Object.defineProperty(navigator, 'maxTouchPoints', originalMaxTouchPoints)
    }
    if (originalOntouchstart) {
      Object.defineProperty(window, 'ontouchstart', originalOntouchstart)
    }
  })

  it('cancels a queued page turn when annotation tap suppression starts before the delay completes', () => {
    vi.useFakeTimers()

    const next = vi.fn<() => void>()
    const onMiddleTap = vi.fn<() => void>()
    const view: ViewLike = {
      prev: vi.fn<() => void>(),
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
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'foliate-click', clientX: 95 }, origin: window.location.origin }))
    input.suppressNextTapNavigation()
    vi.advanceTimersByTime(500)

    expect(next).not.toHaveBeenCalled()
    expect(onMiddleTap).not.toHaveBeenCalled()

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
