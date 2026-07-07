import { onMounted, onUnmounted, ref } from 'vue'

export function useFullscreen(target: () => Element | null = () => document.documentElement) {
  const isFullscreen = ref(false)
  const isFullscreenSupported = ref(false)

  function getTarget() {
    if (typeof document === 'undefined') return null
    return target() ?? document.documentElement
  }

  function updateFullscreenState() {
    if (typeof document === 'undefined') return
    const fullscreenTarget = getTarget()
    isFullscreen.value = !!document.fullscreenElement
    isFullscreenSupported.value = !!document.fullscreenEnabled && !!fullscreenTarget?.requestFullscreen && !!document.exitFullscreen
  }

  async function enterFullscreen() {
    const fullscreenTarget = getTarget()
    if (!fullscreenTarget?.requestFullscreen) return false

    try {
      await fullscreenTarget.requestFullscreen()
      return true
    } catch {
      return false
    } finally {
      updateFullscreenState()
    }
  }

  async function exitFullscreen() {
    if (typeof document === 'undefined' || !document.exitFullscreen) return false

    try {
      await document.exitFullscreen()
      return true
    } catch {
      return false
    } finally {
      updateFullscreenState()
    }
  }

  async function toggleFullscreen() {
    if (typeof document === 'undefined') return false
    if (document.fullscreenElement) return exitFullscreen()
    return enterFullscreen()
  }

  onMounted(() => {
    updateFullscreenState()
    document.addEventListener('fullscreenchange', updateFullscreenState)
  })

  onUnmounted(() => {
    document.removeEventListener('fullscreenchange', updateFullscreenState)
  })

  return {
    isFullscreen,
    isFullscreenSupported,
    enterFullscreen,
    exitFullscreen,
    toggleFullscreen,
  }
}
