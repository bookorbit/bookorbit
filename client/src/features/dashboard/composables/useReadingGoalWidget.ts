import { onMounted, ref } from 'vue'

import type { ReadingGoalWidgetData } from '@bookorbit/types'
import { fetchReadingGoal } from '../api/dashboard-widget.api'

export function useReadingGoalWidget() {
  const data = ref<ReadingGoalWidgetData | null>(null)
  const loading = ref(true)
  const error = ref(false)

  async function load() {
    loading.value = true
    error.value = false
    try {
      data.value = await fetchReadingGoal()
    } catch {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  onMounted(load)
  return { data, loading, error, refresh: load }
}
