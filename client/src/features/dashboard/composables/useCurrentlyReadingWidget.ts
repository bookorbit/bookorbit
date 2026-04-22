import { onMounted, ref } from 'vue'

import type { CurrentlyReadingWidgetData } from '@bookorbit/types'
import { fetchCurrentlyReading } from '../api/dashboard-widget.api'

export function useCurrentlyReadingWidget() {
  const data = ref<CurrentlyReadingWidgetData | null>(null)
  const loading = ref(true)
  const error = ref(false)

  async function load() {
    loading.value = true
    error.value = false
    try {
      data.value = await fetchCurrentlyReading()
    } catch {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  onMounted(load)
  return { data, loading, error, refresh: load }
}
