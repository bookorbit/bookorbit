import { onMounted, onUnmounted, watch, type Ref } from 'vue'
import { SpreadMode, type SpreadScope } from '@embedpdf/plugin-spread'
import type { PdfReaderSettings } from '@bookorbit/types'
import { shouldUseResponsiveSpread } from '../pdf-pagination'

type ReadonlyRef<T> = Readonly<Ref<T>>

export function usePdfResponsiveSpread(
  surface: ReadonlyRef<HTMLElement | null>,
  preference: ReadonlyRef<PdfReaderSettings['spread']>,
  spread: ReadonlyRef<Readonly<SpreadScope> | null>,
) {
  let resizeObserver: ResizeObserver | null = null

  function getSpreadScope() {
    try {
      return spread.value
    } catch {
      return null
    }
  }

  function apply() {
    if (preference.value !== 'auto' || !surface.value) return
    const { width, height } = surface.value.getBoundingClientRect()
    try {
      getSpreadScope()?.setSpreadMode(shouldUseResponsiveSpread(width, height) ? SpreadMode.Odd : SpreadMode.None)
    } catch {
      return
    }
  }

  onMounted(() => {
    if (!surface.value) return
    resizeObserver = new ResizeObserver(apply)
    resizeObserver.observe(surface.value)
    apply()
  })

  watch([surface, preference, getSpreadScope], apply, { flush: 'post' })

  onUnmounted(() => resizeObserver?.disconnect())

  return { apply }
}
