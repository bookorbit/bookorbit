import { onMounted, onUnmounted, ref } from 'vue'

export function useVisibility() {
  const headerVisible = ref(false)
  const footerVisible = ref(false)

  let isPinned = false
  let isVisibilityLocked = false
  let hideTimer: ReturnType<typeof setTimeout> | null = null

  const HEADER_TRIGGER = 80
  const FOOTER_TRIGGER = 80

  function scheduleHide() {
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      if (!isPinned && !isVisibilityLocked) {
        headerVisible.value = false
        footerVisible.value = false
      }
    }, 3000)
  }

  function onMouseMove(e: MouseEvent) {
    if (isVisibilityLocked) return

    const y = e.clientY
    const height = window.innerHeight

    if (!isPinned) {
      if (y < HEADER_TRIGGER) {
        headerVisible.value = true
        scheduleHide()
      } else if (headerVisible.value) {
        scheduleHide()
      }

      if (y > height - FOOTER_TRIGGER) {
        footerVisible.value = true
        scheduleHide()
      } else if (footerVisible.value) {
        scheduleHide()
      }
    }
  }

  function handleMiddleTap() {
    if (isVisibilityLocked) return

    isPinned = !isPinned
    headerVisible.value = isPinned
    footerVisible.value = isPinned
    if (!isPinned) {
      if (hideTimer) clearTimeout(hideTimer)
    }
  }

  function showHeader() {
    if (isVisibilityLocked) {
      headerVisible.value = true
      return
    }

    if (!isPinned) {
      headerVisible.value = true
      scheduleHide()
    }
  }

  function showFooter() {
    if (isVisibilityLocked) {
      footerVisible.value = true
      return
    }

    if (!isPinned) {
      footerVisible.value = true
      scheduleHide()
    }
  }

  function setVisibilityLock(locked: boolean) {
    isVisibilityLocked = locked

    if (hideTimer) clearTimeout(hideTimer)

    if (locked || isPinned) {
      headerVisible.value = true
      footerVisible.value = true
      return
    }

    scheduleHide()
  }

  onMounted(() => {
    document.addEventListener('mousemove', onMouseMove)
  })

  onUnmounted(() => {
    document.removeEventListener('mousemove', onMouseMove)
    if (hideTimer) clearTimeout(hideTimer)
  })

  return { headerVisible, footerVisible, handleMiddleTap, onMouseMove, showHeader, showFooter, setVisibilityLock }
}
