import { ref } from 'vue'
import { api } from '@/lib/api'
import type { KoreaderCredentials, KoreaderSyncStatus, CreateKoreaderCredentialsPayload, UpdateKoreaderCredentialsPayload } from '@bookorbit/types'

const credentials = ref<KoreaderCredentials | null>(null)
const syncStatus = ref<KoreaderSyncStatus | null>(null)
const loading = ref(false)

export function useKoreaderSync() {
  async function fetchSyncStatus(): Promise<void> {
    loading.value = true
    try {
      const res = await api('/api/v1/koreader/sync-status')
      if (!res.ok) throw new Error('Failed to fetch sync status')
      syncStatus.value = await res.json()
      credentials.value = syncStatus.value!.credentials
    } finally {
      loading.value = false
    }
  }

  async function createCredentials(payload: CreateKoreaderCredentialsPayload): Promise<void> {
    const res = await api('/api/v1/koreader/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.message || 'Failed to create credentials')
    }
    await fetchSyncStatus()
  }

  async function updateCredentials(payload: UpdateKoreaderCredentialsPayload): Promise<void> {
    const res = await api('/api/v1/koreader/credentials', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.message || 'Failed to update credentials')
    }
    await fetchSyncStatus()
  }

  async function deleteCredentials(): Promise<void> {
    const res = await api('/api/v1/koreader/credentials', { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete credentials')
    credentials.value = null
    syncStatus.value = null
  }

  async function testConnection(username: string, password: string): Promise<boolean> {
    const res = await api('/api/v1/koreader/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) return false
    const result = await res.json()
    return result.success === true
  }

  function getSyncUrl(): string {
    return `${window.location.origin}/api/v1/koreader`
  }

  async function downloadPluginPackage(): Promise<void> {
    const origin = encodeURIComponent(window.location.origin)
    const res = await api(`/api/v1/koreader/plugin-package?origin=${origin}`)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.message || 'Failed to download the plugin')
    }
    const blob = await res.blob()
    triggerBlobDownload(blob, 'bookorbit.koplugin.zip')
  }

  return {
    credentials,
    syncStatus,
    loading,
    fetchSyncStatus,
    createCredentials,
    updateCredentials,
    deleteCredentials,
    testConnection,
    getSyncUrl,
    downloadPluginPackage,
  }
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
