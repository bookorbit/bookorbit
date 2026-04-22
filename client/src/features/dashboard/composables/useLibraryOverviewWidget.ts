import { onMounted, ref } from 'vue'

import type { LibraryOverviewWidgetData } from '@bookorbit/types'
import { fetchLibraryOverview } from '../api/dashboard-widget.api'

export function useLibraryOverviewWidget() {
  const data = ref<LibraryOverviewWidgetData | null>(null)
  const loading = ref(true)
  const error = ref(false)

  async function load() {
    loading.value = true
    error.value = false
    try {
      data.value = await fetchLibraryOverview()
    } catch {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  onMounted(load)
  return { data, loading, error, refresh: load }
}
