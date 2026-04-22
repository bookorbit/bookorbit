import { onMounted, ref } from 'vue'

import type { DiversityScoreWidgetData } from '@bookorbit/types'
import { fetchDiversityScore } from '../api/dashboard-widget.api'

export function useDiversityScoreWidget() {
  const data = ref<DiversityScoreWidgetData | null>(null)
  const loading = ref(true)
  const error = ref(false)

  async function load() {
    loading.value = true
    error.value = false
    try {
      data.value = await fetchDiversityScore()
    } catch {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  onMounted(load)
  return { data, loading, error, refresh: load }
}
