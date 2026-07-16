import { computed, onUnmounted, ref, watch, type Ref } from 'vue'

const AUTO_HIDE_DELAY_MS = 2500

export function usePdfFullscreenChrome(isFullscreen: Readonly<Ref<boolean>>, hasOpenUi: Readonly<Ref<boolean>>) {
  const pinned = ref(false)
  const visible = ref(true)
  let hideTimer: ReturnType<typeof setTimeout> | null = null

  const canAutoHide = computed(() => isFullscreen.value && !pinned.value && !hasOpenUi.value)

  function clearHideTimer() {
    if (!hideTimer) return
    clearTimeout(hideTimer)
    hideTimer = null
  }

  function scheduleHide() {
    clearHideTimer()
    if (!canAutoHide.value) return
    hideTimer = setTimeout(() => {
      visible.value = false
      hideTimer = null
    }, AUTO_HIDE_DELAY_MS)
  }

  function reveal() {
    visible.value = true
    scheduleHide()
  }

  function togglePinned() {
    pinned.value = !pinned.value
    reveal()
  }

  watch([isFullscreen, hasOpenUi, pinned], () => {
    visible.value = true
    scheduleHide()
  })

  onUnmounted(clearHideTimer)

  return { pinned, visible, reveal, togglePinned }
}
