import { breakpointsTailwind, useBreakpoints } from '@vueuse/core'
import { computed, ref } from 'vue'

const SIDEBAR_PIN_KEY_PREFIX = 'reader:sidebar:pinned'

export function getReaderSidebarPinStorageKey(bookFileId: number): string {
  return `${SIDEBAR_PIN_KEY_PREFIX}:${bookFileId}`
}

function getSessionStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

function readStoredSidebarPinned(key: string): boolean {
  try {
    return getSessionStorage()?.getItem(key) === 'true'
  } catch {
    return false
  }
}

function writeStoredSidebarPinned(key: string, pinned: boolean): void {
  try {
    const storage = getSessionStorage()
    if (!storage) return
    if (pinned) {
      storage.setItem(key, 'true')
    } else {
      storage.removeItem(key)
    }
  } catch {
    // Session storage can be unavailable in private windows.
  }
}

export function useReaderSidebarPin(bookFileId: number) {
  const storageKey = getReaderSidebarPinStorageKey(bookFileId)
  const canPinSidebar = useBreakpoints(breakpointsTailwind).greaterOrEqual('lg')
  const storedPinned = ref(readStoredSidebarPinned(storageKey))
  const isSidebarPinned = computed(() => canPinSidebar.value && storedPinned.value)

  function setSidebarPinned(pinned: boolean): void {
    storedPinned.value = pinned
    writeStoredSidebarPinned(storageKey, pinned)
  }

  function toggleSidebarPinned(): void {
    if (canPinSidebar.value) setSidebarPinned(!isSidebarPinned.value)
  }

  function shouldCloseAfterNavigation(): boolean {
    return !isSidebarPinned.value
  }

  return {
    canPinSidebar,
    isSidebarPinned,
    setSidebarPinned,
    toggleSidebarPinned,
    shouldCloseAfterNavigation,
  }
}
