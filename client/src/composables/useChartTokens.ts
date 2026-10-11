import { computed, type ComputedRef } from 'vue'
import { createChartTokens, type ChartTokens } from '@/lib/echarts'
import { useThemeStore } from '@/stores/theme'

/** Chart colours read from the live tokens, rebuilt whenever an appearance setting changes them. */
export function useChartTokens(): ComputedRef<ChartTokens> {
  const themeStore = useThemeStore()
  return computed(() => createChartTokens(themeStore.appearanceKey, themeStore.resolvedTheme === 'dark'))
}
