import { onMounted, ref } from 'vue'

import type { MonthlyChallengeWidgetData } from '@bookorbit/types'
import { fetchMonthlyChallenge } from '../api/dashboard-widget.api'

export function useMonthlyChallengeWidget() {
  const data = ref<MonthlyChallengeWidgetData | null>(null)
  const loading = ref(true)
  const error = ref(false)

  async function load() {
    loading.value = true
    error.value = false
    try {
      data.value = await fetchMonthlyChallenge()
    } catch {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  onMounted(load)
  return { data, loading, error, refresh: load }
}
