import { computed, ref, watch } from 'vue'

export type FitMode = 'fit-page' | 'fit-width' | 'fit-height' | 'actual'
export type ViewMode = 'single' | 'two-page'
export type ScrollMode = 'paginated' | 'infinite' | 'long-strip'
export type Direction = 'ltr' | 'rtl'
export type BgColor = 'black' | 'gray' | 'white'

interface CbzSettings {
  fitMode: FitMode
  viewMode: ViewMode
  scrollMode: ScrollMode
  direction: Direction
  bgColor: BgColor
}

const STORAGE_KEY = 'cbz-reader-settings'

function loadSaved(): Partial<CbzSettings> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function useCbzSettings() {
  const saved = loadSaved()

  const fitMode = ref<FitMode>(saved.fitMode ?? 'fit-page')
  const viewMode = ref<ViewMode>(saved.viewMode ?? 'single')
  const scrollMode = ref<ScrollMode>(saved.scrollMode ?? 'paginated')
  const direction = ref<Direction>(saved.direction ?? 'ltr')
  const bgColor = ref<BgColor>(saved.bgColor ?? 'black')

  watch([fitMode, viewMode, scrollMode, direction, bgColor], () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        fitMode: fitMode.value,
        viewMode: viewMode.value,
        scrollMode: scrollMode.value,
        direction: direction.value,
        bgColor: bgColor.value,
      }),
    )
  })

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

  return { fitMode, viewMode, scrollMode, direction, bgColor, bgValue, isTwoPage, imgFitClass }
}
