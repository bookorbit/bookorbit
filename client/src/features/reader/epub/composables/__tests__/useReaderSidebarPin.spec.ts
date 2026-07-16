import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getReaderSidebarPinStorageKey, useReaderSidebarPin } from '../useReaderSidebarPin'

describe('useReaderSidebarPin', () => {
  beforeEach(() => {
    sessionStorage.clear()
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
