import { ref } from 'vue'
import type { MetadataProviderInfo } from '@bookorbit/types'
import { api } from '@/lib/api'
import { registerProviderAppearance } from '@/lib/provider-appearance'

const labels = ref<Partial<Record<string, string>>>({})
let loading: Promise<void> | null = null

function load(): Promise<void> {
  return (async () => {
    try {
      const res = await api('/api/v1/metadata-fetch/providers')
      // A refusal stands for the session; an outage is worth asking again.
      if (res.status >= 500) throw new Error(`provider list answered ${res.status}`)
      if (!res.ok) return
      const providers = (await res.json()) as MetadataProviderInfo[]
      labels.value = Object.fromEntries(providers.map((provider) => [provider.key, provider.label]))
      registerProviderAppearance(providers)
    } catch {
      // Non-fatal: callers fall back to the provider key. The next caller tries again.
      loading = null
    }
  })()
}

/**
 * Re-reads the names after providers were added, removed or renamed, so screens already open pick
 * up the change without a reload.
 */
export function refreshMetadataProviderLabels(): Promise<void> {
  loading = load()
  return loading
}

/**
 * Display names for every metadata provider the server knows, external ones included. Built-ins
 * have client-side names already; this is how a provider registered at runtime gets its own name
 * on screens that never load the provider list themselves. Loaded once, then on every refresh.
 */
export function useMetadataProviderLabels() {
  if (!loading) loading = load()
  return { labels }
}
