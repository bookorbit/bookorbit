import { onMounted, ref } from 'vue'
import { api } from '@/lib/api'
import type { AppInfoResponse, ServerFeature } from '@bookorbit/types'

export function useReadAloudDelivery(feature: ServerFeature = 'read-aloud-delivery') {
  const supported = ref(false)
  let pending: Promise<void> | undefined
  async function fetchSupport() {
    pending ??= (async () => {
      supported.value = false
      const response = await api('/api/v1/app-info')
      if (response.ok) supported.value = ((await response.json()) as AppInfoResponse).features?.includes(feature) === true
    })()
      .catch(() => {})
      .finally(() => {
        pending = undefined
      })
    await pending
  }
  onMounted(fetchSupport)
  return { supported, fetchSupport }
}
