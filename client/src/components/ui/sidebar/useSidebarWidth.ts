import { onBeforeUnmount, ref } from 'vue'
import { useSidebarPrefs } from '@/composables/useSidebarPrefs'

export const SIDEBAR_WIDTH_DEFAULT_PX = 256
export const SIDEBAR_WIDTH_MIN_PX = 224
export const SIDEBAR_WIDTH_MAX_PX = 480
export const SIDEBAR_WIDTH_PERSIST_DEBOUNCE_MS = 120

function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_WIDTH_DEFAULT_PX
  const rounded = Math.round(value)
  return Math.min(SIDEBAR_WIDTH_MAX_PX, Math.max(SIDEBAR_WIDTH_MIN_PX, rounded))
}

export function useSidebarWidth() {
  const { readDeviceValue, writeDeviceValue } = useSidebarPrefs()

  const widthPx = ref<number>(clampSidebarWidth(readDeviceValue<number>('width', SIDEBAR_WIDTH_DEFAULT_PX)))
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  let pendingPersistWidth: number | null = null

  function persistWidth(width: number) {
    writeDeviceValue('width', width)
  }

  function schedulePersist(width: number) {
    pendingPersistWidth = width
    if (persistTimer) {
      clearTimeout(persistTimer)
    }
    persistTimer = setTimeout(() => {
      if (pendingPersistWidth !== null) {
        persistWidth(pendingPersistWidth)
        pendingPersistWidth = null
      }
      persistTimer = null
    }, SIDEBAR_WIDTH_PERSIST_DEBOUNCE_MS)
  }

  function setWidth(value: number) {
    const clampedWidth = clampSidebarWidth(value)
    if (clampedWidth === widthPx.value) return
    widthPx.value = clampedWidth
    schedulePersist(clampedWidth)
  }

  onBeforeUnmount(() => {
    if (persistTimer) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    if (pendingPersistWidth !== null) {
      persistWidth(pendingPersistWidth)
      pendingPersistWidth = null
    }
  })

  return {
    widthPx,
    setWidth,
    minWidthPx: SIDEBAR_WIDTH_MIN_PX,
    maxWidthPx: SIDEBAR_WIDTH_MAX_PX,
  }
}
