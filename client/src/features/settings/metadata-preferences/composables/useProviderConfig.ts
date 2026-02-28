import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import type { ProviderConfigurations, ProviderStatus } from '@projectx/types'

export function useProviderConfig() {
  const config = ref<ProviderConfigurations | null>(null)
  const statuses = ref<ProviderStatus[]>([])
  const loading = ref(false)
  const saving = ref(false)

  async function fetchConfig() {
    loading.value = true
    try {
      const res = await api('/api/v1/metadata-preferences/providers')
      if (!res.ok) return
      const data: { config: ProviderConfigurations; statuses: ProviderStatus[] } = await res.json()
      config.value = data.config
      statuses.value = data.statuses
    } finally {
      loading.value = false
    }
  }

  async function saveConfig(patch: Partial<ProviderConfigurations>) {
    saving.value = true
    try {
      const res = await api('/api/v1/metadata-preferences/providers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (res.ok) {
        await fetchConfig()
        toast.success('Provider settings saved')
      } else {
        toast.error('Failed to save provider settings')
      }
    } finally {
      saving.value = false
    }
  }

  return { config, statuses, loading, saving, fetchConfig, saveConfig }
}
