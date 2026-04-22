import { onMounted, ref } from 'vue'

import type { ReadingRhythmWidgetData } from '@bookorbit/types'
import { fetchReadingRhythm } from '../api/dashboard-widget.api'

export function useReadingRhythmWidget() {
  const data = ref<ReadingRhythmWidgetData | null>(null)
  const loading = ref(true)
  const error = ref(false)

  async function load() {
    loading.value = true
    error.value = false
    try {
      data.value = await fetchReadingRhythm()
    } catch {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  onMounted(load)
  return { data, loading, error, refresh: load }
}
