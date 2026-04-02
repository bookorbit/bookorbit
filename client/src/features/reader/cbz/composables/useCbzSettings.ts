import { computed, ref } from 'vue'

export type FitMode = 'fit-page' | 'fit-width' | 'fit-height' | 'actual'
export type ViewMode = 'single' | 'two-page'
export type ScrollMode = 'paginated' | 'infinite' | 'long-strip'
export type Direction = 'ltr' | 'rtl'
export type SpreadAlignment = 'normal' | 'shifted'
export type WidePageSingletonMode = 'auto' | 'disable'
export type BgColor = 'black' | 'gray' | 'white'

export function useCbzSettings() {
  const fitMode = ref<FitMode>('fit-page')
  const viewMode = ref<ViewMode>('single')
  const scrollMode = ref<ScrollMode>('paginated')
  const direction = ref<Direction>('ltr')
  const spreadAlignment = ref<SpreadAlignment>('normal')
  const forceTwoPage = ref(false)
  const widePageSingletonMode = ref<WidePageSingletonMode>('auto')
  const bgColor = ref<BgColor>('black')

  const bgValue = computed(() => {
    if (bgColor.value === 'black') return '#0a0a0a'
    if (bgColor.value === 'gray') return '#525659'
    return '#e8e8e8'
  })

  const isTwoPage = computed(() => viewMode.value === 'two-page' && scrollMode.value === 'paginated')

  const imgFitClass = computed(() => {
    switch (fitMode.value) {
      case 'fit-width':
        return 'w-full h-auto max-w-full'
      case 'fit-height':
        return 'h-full w-auto max-h-full'
      case 'actual':
        return 'max-w-none max-h-none'
      default: // fit-page
        return 'max-w-full max-h-full object-contain'
    }
  })

  return {
    fitMode,
    viewMode,
    scrollMode,
    direction,
    spreadAlignment,
    forceTwoPage,
    widePageSingletonMode,
    bgColor,
    bgValue,
    isTwoPage,
    imgFitClass,
  }
}
