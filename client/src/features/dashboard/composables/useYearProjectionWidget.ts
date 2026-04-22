import { onMounted, ref } from 'vue'

import type { YearProjectionWidgetData } from '@bookorbit/types'
import { fetchYearProjection } from '../api/dashboard-widget.api'

export function useYearProjectionWidget() {
  const data = ref<YearProjectionWidgetData | null>(null)
  const loading = ref(true)
  const error = ref(false)

  async function load() {
    loading.value = true
    error.value = false
    try {
      data.value = await fetchYearProjection()
    } catch {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  onMounted(load)
  return { data, loading, error, refresh: load }
}
