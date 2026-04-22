import { onMounted, ref } from 'vue'

import type { HighlightOfTheDayWidgetData } from '@bookorbit/types'
import { fetchHighlightOfTheDay } from '../api/dashboard-widget.api'

export function useHighlightOfTheDayWidget() {
  const data = ref<HighlightOfTheDayWidgetData | null>(null)
  const loading = ref(true)
  const error = ref(false)

  async function load() {
    loading.value = true
    error.value = false
    try {
      data.value = await fetchHighlightOfTheDay()
    } catch {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  onMounted(load)
  return { data, loading, error, refresh: load }
}
