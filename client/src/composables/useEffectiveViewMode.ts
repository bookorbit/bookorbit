import { computed } from 'vue'
import { breakpointsTailwind, useBreakpoints } from '@vueuse/core'
import { useDisplaySettings, type BookViewMode } from '@/composables/useDisplaySettings'

export function useEffectiveViewMode() {
  const { viewMode } = useDisplaySettings()
  const { md } = useBreakpoints(breakpointsTailwind)

  const effectiveViewMode = computed<BookViewMode>(() => {
    if (!md.value && viewMode.value === 'table') return 'grid'
    return viewMode.value
  })

  return { viewMode, effectiveViewMode }
}
