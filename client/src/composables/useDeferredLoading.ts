import { onScopeDispose, ref, watch, type Ref } from 'vue'

const SHOW_AFTER_MS = 220
const MIN_VISIBLE_MS = 320

/**
 * Gates a loading placeholder on how long the load actually takes.
 *
 * A skeleton that paints and clears inside a couple of frames is not feedback, it is a flash: the
 * book detail tabs answer in well under 100ms locally, so binding shimmer straight to `loading`
 * strobes the pane on every visit. This stays down until the wait is long enough to be worth
 * announcing, and once raised it holds long enough to be read rather than blinking off again.
 */
export function useDeferredLoading(loading: Ref<boolean>, options?: { showAfterMs?: number; minVisibleMs?: number }): Ref<boolean> {
  const showAfterMs = options?.showAfterMs ?? SHOW_AFTER_MS
  const minVisibleMs = options?.minVisibleMs ?? MIN_VISIBLE_MS

  const visible = ref(false)
  let showTimer: ReturnType<typeof setTimeout> | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let shownAt = 0

  function clearTimers() {
    if (showTimer !== null) {
      clearTimeout(showTimer)
      showTimer = null
    }
    if (hideTimer !== null) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
  }

  watch(
    loading,
    (busy) => {
      clearTimers()
      if (busy) {
        if (visible.value) return
        showTimer = setTimeout(() => {
          showTimer = null
          shownAt = performance.now()
          visible.value = true
        }, showAfterMs)
        return
      }
      if (!visible.value) return
      const remaining = minVisibleMs - (performance.now() - shownAt)
      if (remaining <= 0) {
        visible.value = false
        return
      }
      hideTimer = setTimeout(() => {
        hideTimer = null
        visible.value = false
      }, remaining)
    },
    { immediate: true },
  )

  onScopeDispose(clearTimers)

  return visible
}
