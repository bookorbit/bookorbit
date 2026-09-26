import { onUnmounted, ref } from 'vue'

const AUTO_HIDE_DELAY_MS = 3000

export function useVisibility() {
  const headerVisible = ref(false)
  const footerVisible = ref(false)
  const isPinned = ref(false)

  let isVisibilityLocked = false
  let hideTimer: ReturnType<typeof setTimeout> | null = null

  function clearHideTimer() {
    if (!hideTimer) return
    clearTimeout(hideTimer)
    hideTimer = null
  }

  function scheduleHide() {
    clearHideTimer()
    hideTimer = setTimeout(() => {
      if (!isPinned.value && !isVisibilityLocked) {
        headerVisible.value = false
        footerVisible.value = false
      }
      hideTimer = null
    }, AUTO_HIDE_DELAY_MS)
  }

  function handleMiddleTap() {
    if (isVisibilityLocked) return
    if (isPinned.value) return

    if (headerVisible.value || footerVisible.value) {
      clearHideTimer()
      headerVisible.value = false
      footerVisible.value = false
      return
    }

    headerVisible.value = true
    footerVisible.value = true
    scheduleHide()
  }

  function togglePinned() {
    isPinned.value = !isPinned.value
    headerVisible.value = true
    footerVisible.value = true

    if (isPinned.value) {
      clearHideTimer()
    } else {
      scheduleHide()
    }
  }

  function showHeader() {
    if (isVisibilityLocked) {
      headerVisible.value = true
      return
    }

    if (!isPinned.value) {
      headerVisible.value = true
      scheduleHide()
    }
  }

  function showFooter() {
    if (isVisibilityLocked) {
      footerVisible.value = true
      return
    }

    if (!isPinned.value) {
      footerVisible.value = true
      scheduleHide()
    }
  }

  function hideOverlays(force = false) {
    if (isVisibilityLocked && !force) return

    clearHideTimer()
    isPinned.value = false
    headerVisible.value = false
    footerVisible.value = false
  }

  function setVisibilityLock(locked: boolean) {
    isVisibilityLocked = locked

    clearHideTimer()

    if (locked) {
      headerVisible.value = true
      return
    }

    if (isPinned.value) {
      headerVisible.value = true
      footerVisible.value = true
      return
    }

    headerVisible.value = false
    footerVisible.value = false
  }

  onUnmounted(clearHideTimer)

  return { headerVisible, footerVisible, isPinned, handleMiddleTap, togglePinned, showHeader, showFooter, hideOverlays, setVisibilityLock }
}
