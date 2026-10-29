import { ref } from 'vue'
import type { MetadataProviderDirectory, MetadataProviderDirectoryEntry } from '@bookorbit/types'
import { api } from '@/lib/api'

/**
 * The Compose service for one ready-made provider, indented to sit under `services:`. The service
 * name is the provider's key, so the address the Add sheet is prefilled with resolves to it.
 */
export function composeServiceFor(entry: MetadataProviderDirectoryEntry): string {
  return [`  ${entry.key}:`, `    image: ${entry.image}:${entry.version}`, '    restart: unless-stopped', ''].join('\n')
}

/** Where BookOrbit reaches the provider when it runs beside it in the same Compose project. */
export function composeAddressFor(entry: MetadataProviderDirectoryEntry): string {
  return `http://${entry.key}:${entry.port}`
}

export function useProviderDirectory() {
  const directory = ref<MetadataProviderDirectory | null>(null)
  const failed = ref(false)

  async function fetchDirectory(): Promise<void> {
    try {
      const res = await api('/api/v1/metadata-http-providers/directory')
      if (!res.ok) throw new Error(String(res.status))
      directory.value = (await res.json()) as MetadataProviderDirectory
      failed.value = false
    } catch {
      failed.value = true
    }
  }

  return { directory, failed, fetchDirectory }
}
