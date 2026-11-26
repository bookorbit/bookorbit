import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { useReaderKeyboardShortcuts, type ShortcutHandlers, type ShortcutOptions } from '../useReaderKeyboardShortcuts'

function makeHandlers(): ShortcutHandlers {
  return {
    toggleSidebar: vi.fn<() => void>(),
    toggleSearch: vi.fn<() => void>(),
    toggleBookmark: vi.fn<() => void>(),
    toggleFullscreen: vi.fn<() => void>(),
    cycleFooterMode: vi.fn<() => void>(),
    closePanel: vi.fn<() => void>(),
    goToStart: vi.fn<() => void>(),
    goToEnd: vi.fn<() => void>(),
  }
}

function fireKey(key: string) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}

function mountWithShortcuts(handlers: ShortcutHandlers, options?: ShortcutOptions) {
  let result: ReturnType<typeof useReaderKeyboardShortcuts>
  const wrapper = mount(
    defineComponent({
      setup() {
        result = useReaderKeyboardShortcuts(handlers, options)
        return result
      },
      template: '<div />',
    }),
  )
  return { wrapper, result: result! }
}

describe('useReaderKeyboardShortcuts', () => {
  let handlers: ShortcutHandlers
  let wrapper: ReturnType<typeof mount>
  let result: ReturnType<typeof useReaderKeyboardShortcuts>

  afterEach(() => {
    wrapper?.unmount()
  })

  function setup() {
    handlers = makeHandlers()
    const mounted = mountWithShortcuts(handlers)
    wrapper = mounted.wrapper
    result = mounted.result
  }

  it('triggers toggleSidebar on "t" key', () => {
    setup()
    fireKey('t')
    expect(handlers.toggleSidebar).toHaveBeenCalledOnce()
  })

  it('triggers toggleSearch on "s" key', () => {
    setup()
    fireKey('s')
    expect(handlers.toggleSearch).toHaveBeenCalledOnce()
  })

  it('triggers toggleBookmark on "b" key', () => {
    setup()
    fireKey('b')
    expect(handlers.toggleBookmark).toHaveBeenCalledOnce()
  })

  it('triggers toggleFullscreen on "f" key', () => {
    setup()
    fireKey('f')
    expect(handlers.toggleFullscreen).toHaveBeenCalledOnce()
  })

  it('triggers cycleFooterMode on "m" key', () => {
    setup()
    fireKey('m')
    expect(handlers.cycleFooterMode).toHaveBeenCalledOnce()
  })

  it('triggers closePanel on "Escape" key', () => {
    setup()
    fireKey('Escape')
    expect(handlers.closePanel).toHaveBeenCalledOnce()
  })

  it('triggers goToStart on "Home" key', () => {
    setup()
    fireKey('Home')
    expect(handlers.goToStart).toHaveBeenCalledOnce()
  })

  it('triggers goToEnd on "End" key', () => {
    setup()
    fireKey('End')
    expect(handlers.goToEnd).toHaveBeenCalledOnce()
  })

  it('toggles help modal on "?" key', () => {
    setup()
    expect(result.showHelpModal.value).toBe(false)
    fireKey('?')
    expect(result.showHelpModal.value).toBe(true)
    fireKey('?')
    expect(result.showHelpModal.value).toBe(false)
  })

  it('closes help modal on Escape when modal is open', () => {
    setup()
    fireKey('?')
    expect(result.showHelpModal.value).toBe(true)

    fireKey('Escape')
    expect(result.showHelpModal.value).toBe(false)
    expect(handlers.closePanel).not.toHaveBeenCalled()
  })

  it('ignores shortcuts when input element is focused', () => {
    setup()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }))

    expect(handlers.toggleSidebar).not.toHaveBeenCalled()
    document.body.removeChild(input)
  })

  it('ignores shortcuts when textarea is focused', () => {
    setup()
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    textarea.focus()

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))

    expect(handlers.toggleSearch).not.toHaveBeenCalled()
    document.body.removeChild(textarea)
  })

  it('does not trigger on unregistered keys', () => {
    setup()
    fireKey('x')
    fireKey('z')
    fireKey('1')

    expect(handlers.toggleSidebar).not.toHaveBeenCalled()
    expect(handlers.toggleSearch).not.toHaveBeenCalled()
    expect(handlers.toggleBookmark).not.toHaveBeenCalled()
    expect(handlers.toggleFullscreen).not.toHaveBeenCalled()
    expect(handlers.cycleFooterMode).not.toHaveBeenCalled()
    expect(handlers.closePanel).not.toHaveBeenCalled()
    expect(handlers.goToStart).not.toHaveBeenCalled()
    expect(handlers.goToEnd).not.toHaveBeenCalled()
  })

  it('cleans up listener on unmount', () => {
    setup()
    wrapper.unmount()

    fireKey('t')
    expect(handlers.toggleSidebar).not.toHaveBeenCalled()
  })

  it('leaves every key alone when disabled for a reader that brings its own keys', () => {
    handlers = makeHandlers()
    const mounted = mountWithShortcuts(handlers, { enabled: false })
    wrapper = mounted.wrapper
    const events = ['t', 's', 'b', 'f', 'm', '?', 'Escape', 'Home', 'End'].map((key) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      document.dispatchEvent(event)
      return event
    })

    expect(events.every((event) => !event.defaultPrevented)).toBe(true)
    expect(Object.values(handlers).every((handler) => vi.mocked(handler).mock.calls.length === 0)).toBe(true)
    expect(mounted.result.showHelpModal.value).toBe(false)
  })
})
