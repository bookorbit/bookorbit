import { onMounted, ref } from 'vue'

import type { ReadingDnaWidgetData } from '@bookorbit/types'
import { fetchReadingDna } from '../api/dashboard-widget.api'

export function useReadingDnaWidget() {
  const data = ref<ReadingDnaWidgetData | null>(null)
  const loading = ref(true)
  const error = ref(false)

  async function load() {
    loading.value = true
    error.value = false
    try {
      data.value = await fetchReadingDna()
    } catch {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  onMounted(load)
  return { data, loading, error, refresh: load }
}
