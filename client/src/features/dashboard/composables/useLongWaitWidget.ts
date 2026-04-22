import { onMounted, ref } from 'vue'

import type { LongWaitWidgetData } from '@bookorbit/types'
import { fetchLongWait } from '../api/dashboard-widget.api'

export function useLongWaitWidget() {
  const data = ref<LongWaitWidgetData | null>(null)
  const loading = ref(true)
  const error = ref(false)

  async function load() {
    loading.value = true
    error.value = false
    try {
      data.value = await fetchLongWait()
    } catch {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  onMounted(load)
  return { data, loading, error, refresh: load }
}
