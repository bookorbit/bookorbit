import { onUnmounted, ref, watch, type Ref } from 'vue'
import { useMediaQuery } from '@vueuse/core'

const MOBILE_PREVIEW_DELAY_MS = 250

/**
 * Mirrors a pattern input so the live preview does not re-render on every keystroke
 * on phones, where per-character path resolution makes the on-screen keyboard lag.
 * Desktop keeps the mirror in lockstep with the source.
 */
export function useDebouncedPatternPreview(source: Ref<string>): Ref<string> {
  const isMobile = useMediaQuery('(max-width: 767px)')
  const mirrored = ref(source.value)
  let timer: ReturnType<typeof setTimeout> | null = null

  watch(
    source,
    (value) => {
      if (timer) clearTimeout(timer)
      if (!isMobile.value) {
        mirrored.value = value
        return
      }
      timer = setTimeout(() => {
        mirrored.value = value
      }, MOBILE_PREVIEW_DELAY_MS)
    },
    { immediate: true },
  )

  watch(isMobile, () => {
    if (timer) clearTimeout(timer)
    mirrored.value = source.value
  })

  onUnmounted(() => {
    if (timer) clearTimeout(timer)
  })

  return mirrored
}
