import { computed, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type { PageDim } from './usePdf'

export type ZoomMode = 'fit-width' | 'fit-page' | 'custom'

export const ZOOM_PRESETS = [
  { label: '50%', value: '0.5' },
  { label: '75%', value: '0.75' },
  { label: '100%', value: '1' },
  { label: '125%', value: '1.25' },
  { label: '150%', value: '1.5' },
  { label: '200%', value: '2' },
] as const

// Horizontal gap between paired pages in spread mode
const SPREAD_GAP = 16

export function usePdfZoom(
  containerW: Ref<number>,
  containerH: Ref<number>,
  effectiveDims: ComputedRef<PageDim[]>,
  spread: Ref<'none' | 'odd' | 'even'>,
) {
  const zoomMode = ref<ZoomMode>('fit-page')
  const customScale = ref(1.0)

  const scale = computed(() => {
    const first = effectiveDims.value[0]
    if (!first || !containerW.value) return 1
    if (spread.value !== 'none') {
      const sw = (containerW.value - 48) / (first.width * 2 + SPREAD_GAP)
      if (zoomMode.value === 'fit-page') return Math.min(sw, (containerH.value - 48) / first.height)
      if (zoomMode.value === 'fit-width') return sw
    }
    if (zoomMode.value === 'fit-width') return (containerW.value - 32) / first.width
    if (zoomMode.value === 'fit-page') return Math.min((containerW.value - 32) / first.width, (containerH.value - 48) / first.height)
    return customScale.value
  })

  const zoomPct = computed(() => Math.round(scale.value * 100))

  const zoomLabel = computed(() => {
    if (zoomMode.value === 'fit-width') return 'Fit Width'
    if (zoomMode.value === 'fit-page') return 'Fit Page'
    return `${zoomPct.value}%`
  })

  function adjustZoom(delta: number) {
    customScale.value = Math.round(Math.max(0.25, Math.min(4, (zoomMode.value === 'custom' ? customScale.value : scale.value) + delta)) * 20) / 20
    zoomMode.value = 'custom'
  }

  function applyZoomPreset(value: string) {
    if (value === 'fit-width' || value === 'fit-page') {
      zoomMode.value = value
    } else {
      customScale.value = parseFloat(value)
      zoomMode.value = 'custom'
    }
  }

  return { zoomMode, customScale, scale, zoomPct, zoomLabel, adjustZoom, applyZoomPreset }
}
