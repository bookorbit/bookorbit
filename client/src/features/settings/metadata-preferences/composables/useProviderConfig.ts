import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import { registerProviderAppearance } from '@/lib/provider-appearance'
import { isBuiltInMetadataProviderKey, MetadataProviderKey } from '@bookorbit/types'
import type { ProviderConfigurations, ProviderConnectionTestResult, ProviderStatus } from '@bookorbit/types'
import { stripBearerPrefix } from '../lib/provider-token'

export function useProviderConfig() {
  const config = ref<ProviderConfigurations | null>(null)
  const statuses = ref<ProviderStatus[]>([])
  const loading = ref(false)
  const saving = ref(false)
  const testingByKey = ref<Partial<Record<MetadataProviderKey, boolean>>>({})
  const testResultsByKey = ref<Partial<Record<MetadataProviderKey, ProviderConnectionTestResult>>>({})
  const passingTestSignatureByKey = ref<Partial<Record<MetadataProviderKey, string>>>({})

  function normalizePatchForSignature(key: MetadataProviderKey, patch: Partial<ProviderConfigurations>): unknown {
    // External providers have their own settings and never reach this built-in config form.
    if (!isBuiltInMetadataProviderKey(key)) return null
    const value = patch[key]
    if (!value) return null
    if (key !== MetadataProviderKey.HARDCOVER) return value
    const hardcoverConfig = value as ProviderConfigurations['hardcover']
    return {
      ...hardcoverConfig,
      apiKey: stripBearerPrefix(hardcoverConfig.apiKey ?? ''),
    }
  }

  function patchSignatureFor(key: MetadataProviderKey, patch: Partial<ProviderConfigurations>): string {
    return JSON.stringify(normalizePatchForSignature(key, patch))
  }

  function clearPassingSignature(key: MetadataProviderKey): void {
    const next = { ...passingTestSignatureByKey.value }
    delete next[key]
    passingTestSignatureByKey.value = next
  }

  async function fetchConfig() {
    loading.value = true
    try {
      const res = await api('/api/v1/metadata-preferences/providers')
      if (!res.ok) return
      const data: { config: ProviderConfigurations; statuses: ProviderStatus[] } = await res.json()
      config.value = data.config
      statuses.value = data.statuses
      registerProviderAppearance(data.statuses.filter((status) => status.source === 'external'))
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
        const data = await res.json().catch(() => null)
        const message = typeof data?.message === 'string' ? data.message : 'Failed to save provider settings'
        toast.error(message)
      }
    } finally {
      saving.value = false
    }
  }

  async function testProvider(key: MetadataProviderKey, patch: Partial<ProviderConfigurations>): Promise<ProviderConnectionTestResult | null> {
    testingByKey.value = { ...testingByKey.value, [key]: true }
    const signature = patchSignatureFor(key, patch)
    try {
      const res = await api(`/api/v1/metadata-preferences/providers/${key}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = (await res.json().catch(() => null)) as ProviderConnectionTestResult | { message?: string } | null
      if (!res.ok) {
        const message = typeof data?.message === 'string' ? data.message : 'Provider test failed'
        throw new Error(message)
      }
      const result = data as ProviderConnectionTestResult
      testResultsByKey.value = { ...testResultsByKey.value, [key]: result }
      if (result.ok && result.status === 'success') {
        passingTestSignatureByKey.value = { ...passingTestSignatureByKey.value, [key]: signature }
      } else {
        clearPassingSignature(key)
      }
      return result
    } catch (error) {
      clearPassingSignature(key)
      const message = error instanceof Error ? error.message : 'Provider test failed'
      toast.error(message)
      return null
    } finally {
      testingByKey.value = { ...testingByKey.value, [key]: false }
    }
  }

  return { config, statuses, loading, saving, testingByKey, testResultsByKey, passingTestSignatureByKey, fetchConfig, saveConfig, testProvider }
}
