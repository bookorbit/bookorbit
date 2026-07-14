import { ref } from 'vue'
import { api } from '@/lib/api'
import type {
  CreateKoreaderCredentialsPayload,
  DismissAllKoreaderUnmatchedBooksResult,
  DismissKoreaderUnmatchedBookResult,
  KoreaderCredentials,
  KoreaderManualHashLink,
  KoreaderSyncStatus,
  KoreaderUnmatchedBook,
  LinkKoreaderUnmatchedBookPayload,
  LinkKoreaderUnmatchedBookResult,
  UnlinkKoreaderManualHashLinkResult,
  UpdateKoreaderCredentialsPayload,
  UpdateKoreaderManualHashLinkPayload,
} from '@bookorbit/types'

const credentials = ref<KoreaderCredentials | null>(null)
const syncStatus = ref<KoreaderSyncStatus | null>(null)
const unmatchedBooks = ref<KoreaderUnmatchedBook[]>([])
const manualHashLinks = ref<KoreaderManualHashLink[]>([])
const loading = ref(false)
const unmatchedLoading = ref(false)
const manualLinksLoading = ref(false)
const fileNamingPattern = ref('')

export type KoreaderFileNamingRequestErrorCode = 'load' | 'account-save' | 'device-save' | 'device-reset'

export class KoreaderFileNamingRequestError extends Error {
  constructor(readonly code: KoreaderFileNamingRequestErrorCode) {
    super(code)
    this.name = 'KoreaderFileNamingRequestError'
  }
}

export function useKoreaderSync() {
  async function fetchSyncStatus(silent = false): Promise<void> {
    if (!silent) loading.value = true
    try {
      const res = await api('/api/v1/koreader/sync-status')
      if (!res.ok) throw new Error('Failed to fetch sync status')
      syncStatus.value = await res.json()
      credentials.value = syncStatus.value!.credentials
    } finally {
      if (!silent) loading.value = false
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
    await fetchSyncStatus(true)
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
    await fetchSyncStatus(true)
  }

  async function deleteCredentials(): Promise<void> {
    const res = await api('/api/v1/koreader/credentials', { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete credentials')
    credentials.value = null
    syncStatus.value = null
    unmatchedBooks.value = []
    manualHashLinks.value = []
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
    return window.location.origin
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

  async function fetchUnmatchedBooks(): Promise<void> {
    unmatchedLoading.value = true
    try {
      const res = await api('/api/v1/koreader/unmatched-books')
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.message || 'Failed to fetch unmatched KOReader books')
      }
      unmatchedBooks.value = await res.json()
    } finally {
      unmatchedLoading.value = false
    }
  }

  async function fetchManualHashLinks(): Promise<void> {
    manualLinksLoading.value = true
    try {
      const res = await api('/api/v1/koreader/hash-links')
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.message || 'Failed to fetch KOReader manual links')
      }
      manualHashLinks.value = await res.json()
    } finally {
      manualLinksLoading.value = false
    }
  }

  async function linkUnmatchedBook(hash: string, payload: LinkKoreaderUnmatchedBookPayload): Promise<LinkKoreaderUnmatchedBookResult> {
    const res = await api(`/api/v1/koreader/unmatched-books/${hash}/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.message || 'Failed to link KOReader book')
    }
    const result: LinkKoreaderUnmatchedBookResult = await res.json()
    unmatchedBooks.value = unmatchedBooks.value.filter((book) => book.hash !== result.hash)
    await Promise.all([fetchSyncStatus(true), fetchManualHashLinks()])
    return result
  }

  async function dismissUnmatchedBook(hash: string): Promise<DismissKoreaderUnmatchedBookResult> {
    const res = await api(`/api/v1/koreader/unmatched-books/${hash}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.message || 'Failed to dismiss KOReader unmatched book')
    }
    const result: DismissKoreaderUnmatchedBookResult = await res.json()
    unmatchedBooks.value = unmatchedBooks.value.filter((book) => book.hash !== result.hash)
    await fetchSyncStatus(true)
    return result
  }

  async function dismissAllUnmatchedBooks(): Promise<DismissAllKoreaderUnmatchedBooksResult> {
    const res = await api('/api/v1/koreader/unmatched-books', { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.message || 'Failed to dismiss all KOReader unmatched books')
    }
    const result: DismissAllKoreaderUnmatchedBooksResult = await res.json()
    unmatchedBooks.value = []
    await fetchSyncStatus(true)
    return result
  }

  async function relinkManualHashLink(hash: string, payload: UpdateKoreaderManualHashLinkPayload): Promise<LinkKoreaderUnmatchedBookResult> {
    const res = await api(`/api/v1/koreader/hash-links/${hash}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.message || 'Failed to update KOReader manual link')
    }
    const result: LinkKoreaderUnmatchedBookResult = await res.json()
    await Promise.all([fetchSyncStatus(true), fetchManualHashLinks()])
    return result
  }

  async function unlinkManualHashLink(hash: string): Promise<UnlinkKoreaderManualHashLinkResult> {
    const res = await api(`/api/v1/koreader/hash-links/${hash}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.message || 'Failed to unlink KOReader manual link')
    }
    const result: UnlinkKoreaderManualHashLinkResult = await res.json()
    manualHashLinks.value = manualHashLinks.value.filter((link) => link.hash !== result.hash)
    await Promise.all([fetchSyncStatus(true), fetchUnmatchedBooks()])
    return result
  }

  async function fetchFileNamingPattern(): Promise<void> {
    const res = await api('/api/v1/koreader/file-naming-pattern')
    if (!res.ok) throw new KoreaderFileNamingRequestError('load')
    const body = await res.json()
    fileNamingPattern.value = body.pattern
  }

  async function saveFileNamingPattern(config: { pattern: string }): Promise<void> {
    const res = await api('/api/v1/koreader/file-naming-pattern', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
    if (!res.ok) throw new KoreaderFileNamingRequestError('account-save')
    fileNamingPattern.value = config.pattern
  }

  async function saveDeviceFileNamingPattern(
    deviceId: string,
    config: { pattern: string; seriesPattern: string; standalonePattern: string },
  ): Promise<void> {
    const res = await api(`/api/v1/koreader/devices/${encodeURIComponent(deviceId)}/file-naming-pattern`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
    if (!res.ok) throw new KoreaderFileNamingRequestError('device-save')
    await fetchSyncStatus(true)
  }

  async function clearDeviceFileNamingPattern(deviceId: string): Promise<void> {
    const res = await api(`/api/v1/koreader/devices/${encodeURIComponent(deviceId)}/file-naming-pattern`, { method: 'DELETE' })
    if (!res.ok) throw new KoreaderFileNamingRequestError('device-reset')
    await fetchSyncStatus(true)
  }

  async function removeDevice(deviceId: string): Promise<void> {
    const res = await api(`/api/v1/koreader/devices/${deviceId}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.message || 'Failed to remove KOReader device')
    }
    await fetchSyncStatus(true)
  }

  return {
    credentials,
    syncStatus,
    unmatchedBooks,
    manualHashLinks,
    loading,
    unmatchedLoading,
    manualLinksLoading,
    fileNamingPattern,
    fetchSyncStatus,
    fetchUnmatchedBooks,
    fetchManualHashLinks,
    createCredentials,
    updateCredentials,
    deleteCredentials,
    testConnection,
    getSyncUrl,
    downloadPluginPackage,
    linkUnmatchedBook,
    dismissUnmatchedBook,
    dismissAllUnmatchedBooks,
    relinkManualHashLink,
    unlinkManualHashLink,
    fetchFileNamingPattern,
    saveFileNamingPattern,
    saveDeviceFileNamingPattern,
    clearDeviceFileNamingPattern,
    removeDevice,
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
