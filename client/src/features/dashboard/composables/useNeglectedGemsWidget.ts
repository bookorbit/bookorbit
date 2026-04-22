import { onMounted, ref } from 'vue'

import type { NeglectedGemsWidgetData } from '@bookorbit/types'
import { fetchNeglectedGems } from '../api/dashboard-widget.api'

export function useNeglectedGemsWidget() {
  const data = ref<NeglectedGemsWidgetData | null>(null)
  const loading = ref(true)
  const error = ref(false)

  async function load() {
    loading.value = true
    error.value = false
    try {
      data.value = await fetchNeglectedGems()
    } catch {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  onMounted(load)
  return { data, loading, error, refresh: load }
}
