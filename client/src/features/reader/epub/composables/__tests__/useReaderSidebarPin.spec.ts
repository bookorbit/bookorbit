import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { getReaderSidebarPinStorageKey, useReaderSidebarPin } from '../useReaderSidebarPin'

const isDesktop = ref(true)
vi.mock('@vueuse/core', () => ({
  breakpointsTailwind: {},
  useBreakpoints: () => ({ greaterOrEqual: () => isDesktop }),
}))

describe('useReaderSidebarPin', () => {
  beforeEach(() => {
    sessionStorage.clear()
    isDesktop.value = true
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('defaults to unpinned and closes after navigation', () => {
    const sidebarPin = useReaderSidebarPin(42)

    expect(sidebarPin.isSidebarPinned.value).toBe(false)
    expect(sidebarPin.shouldCloseAfterNavigation()).toBe(true)
  })

  it('persists pinned state in session storage per book file', () => {
    const key = getReaderSidebarPinStorageKey(42)
    const sidebarPin = useReaderSidebarPin(42)

    sidebarPin.toggleSidebarPinned()

    expect(sidebarPin.isSidebarPinned.value).toBe(true)
    expect(sidebarPin.shouldCloseAfterNavigation()).toBe(false)
    expect(sessionStorage.getItem(key)).toBe('true')
    expect(useReaderSidebarPin(42).isSidebarPinned.value).toBe(true)
    expect(useReaderSidebarPin(43).isSidebarPinned.value).toBe(false)
  })

  it('removes stored state when unpinned', () => {
    const key = getReaderSidebarPinStorageKey(42)
    sessionStorage.setItem(key, 'true')

    const sidebarPin = useReaderSidebarPin(42)
    sidebarPin.setSidebarPinned(false)

    expect(sidebarPin.isSidebarPinned.value).toBe(false)
    expect(sessionStorage.getItem(key)).toBeNull()
  })

  it('restores the saved pin when the viewport is wide enough again', () => {
    const key = getReaderSidebarPinStorageKey(42)
    sessionStorage.setItem(key, 'true')
    const sidebarPin = useReaderSidebarPin(42)

    isDesktop.value = false

    expect(sidebarPin.isSidebarPinned.value).toBe(false)
    expect(sidebarPin.shouldCloseAfterNavigation()).toBe(true)

    sidebarPin.toggleSidebarPinned()
    expect(sessionStorage.getItem(key)).toBe('true')

    isDesktop.value = true

    expect(sidebarPin.isSidebarPinned.value).toBe(true)
    expect(sidebarPin.shouldCloseAfterNavigation()).toBe(false)
  })

  it('keeps working when session storage is unavailable', () => {
    vi.stubGlobal('window', {
      get sessionStorage() {
        throw new Error('unavailable')
      },
    })

    const sidebarPin = useReaderSidebarPin(42)

    expect(sidebarPin.isSidebarPinned.value).toBe(false)
    expect(() => sidebarPin.setSidebarPinned(true)).not.toThrow()
    expect(sidebarPin.isSidebarPinned.value).toBe(true)
  })
})
