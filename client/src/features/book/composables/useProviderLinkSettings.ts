import { ref } from 'vue'
import { api } from '@/lib/api'
import type { ProviderLinkSettings } from '@/features/book/lib/provider-links'

const DEFAULT_SETTINGS: ProviderLinkSettings = { amazonDomain: 'amazon.com' }
const settings = ref<ProviderLinkSettings>(DEFAULT_SETTINGS)
let pendingRequest: Promise<void> | null = null

export function useProviderLinkSettings() {
  function loadSettings(): Promise<void> {
    if (pendingRequest) return pendingRequest

    pendingRequest = (async () => {
      try {
        const response = await api('/api/v1/metadata-preferences/provider-links')
        if (!response.ok) return
        const data: unknown = await response.json()
        if (
          typeof data === 'object' &&
          data !== null &&
          'amazonDomain' in data &&
          typeof data.amazonDomain === 'string' &&
          data.amazonDomain.trim()
        ) {
          settings.value = { amazonDomain: data.amazonDomain }
        }
      } catch {
        return
      } finally {
        pendingRequest = null
      }
    })()

    return pendingRequest
  }

  return { settings, loadSettings }
}
