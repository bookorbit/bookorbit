import { onMounted, ref } from 'vue'

import type { ReadingStreakWidgetData } from '@bookorbit/types'
import { fetchReadingStreak } from '../api/dashboard-widget.api'

export function useReadingStreakWidget() {
  const data = ref<ReadingStreakWidgetData | null>(null)
  const loading = ref(true)
  const error = ref(false)

  async function load() {
    loading.value = true
    error.value = false
    try {
      data.value = await fetchReadingStreak()
    } catch {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  onMounted(load)
  return { data, loading, error, refresh: load }
}
