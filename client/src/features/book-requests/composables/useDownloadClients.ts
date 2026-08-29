import { ref } from 'vue'
import { api } from '@/lib/api'
import { fulfilmentBase } from '../fulfilmentBase'
import type {
  CreateDownloadClientPayload,
  DownloadClientErrorCode,
  DownloadClientItem,
  DownloadClientListResult,
  DownloadClientReconciliationResult,
  DownloadClientSummary,
  DownloadClientTestResult,
  PathMappingHardlinkTestResult,
  UpdateDownloadClientPayload,
} from '@bookorbit/types'

const BASE_PATH = '/api/v1/admin/download-clients'

/**
 * A failed call reports a stable code when the server sent one, so the page can say what went
 * wrong in the reader's own language rather than forwarding an English sentence.
 */
export interface DownloadClientFailure {
  errorCode: DownloadClientErrorCode | null
  message: string | null
}

async function toFailure(res: Response): Promise<DownloadClientFailure> {
  try {
    const body = (await res.json()) as { message?: string | string[]; errorCode?: string }
    const message = Array.isArray(body.message) ? (body.message[0] ?? null) : (body.message ?? null)
    return { errorCode: (body.errorCode as DownloadClientErrorCode | undefined) ?? null, message }
  } catch {
    return { errorCode: null, message: null }
  }
}

const NETWORK_FAILURE: DownloadClientFailure = { errorCode: null, message: null }

export function useDownloadClients() {
  const clients = ref<DownloadClientItem[]>([])
  /** False when `BOOK_REQUEST_ENCRYPTION_KEY` is unset, which is what refuses a saved password. */
  const encryptionConfigured = ref(true)
  const loading = ref(false)
  const saving = ref(false)
  const loadFailed = ref(false)
  const reconciliation = ref<Record<number, DownloadClientReconciliationResult | undefined>>({})
  const reconcilingIds = ref<Set<number>>(new Set())

  function markReconciling(id: number, active: boolean) {
    const next = new Set(reconcilingIds.value)
    if (active) next.add(id)
    else next.delete(id)
    reconcilingIds.value = next
  }

  /**
   * `silent` refreshes the list without blanking the panel. The loading flag swaps the whole
   * section for a spinner, which after a test or a save reads as the page reloading and throws
   * away the reader's scroll position, so it is only for the first load.
   */
  async function fetchClients({ silent = false }: { silent?: boolean } = {}): Promise<void> {
    if (!silent) loading.value = true
    loadFailed.value = false
    try {
      const res = await api(BASE_PATH)
      if (!res.ok) {
        loadFailed.value = true
        return
      }
      const result = (await res.json()) as DownloadClientListResult
      clients.value = result.clients
      encryptionConfigured.value = result.encryptionConfigured
    } catch {
      loadFailed.value = true
    } finally {
      loading.value = false
    }
  }

  async function save(id: number | null, payload: CreateDownloadClientPayload | UpdateDownloadClientPayload): Promise<DownloadClientFailure | null> {
    saving.value = true
    try {
      const res = await api(id === null ? BASE_PATH : `${BASE_PATH}/${id}`, {
        method: id === null ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) return await toFailure(res)
      await fetchClients({ silent: true })
      return null
    } catch {
      return NETWORK_FAILURE
    } finally {
      saving.value = false
    }
  }

  async function remove(id: number): Promise<boolean> {
    saving.value = true
    try {
      const res = await api(`${BASE_PATH}/${id}`, { method: 'DELETE' })
      if (!res.ok) return false
      await fetchClients({ silent: true })
      return true
    } catch {
      return false
    } finally {
      saving.value = false
    }
  }

  async function test(id: number): Promise<DownloadClientTestResult> {
    try {
      const res = await api(`${BASE_PATH}/${id}/test`, { method: 'POST' })
      // A failed test answers 502 carrying its reason, so both outcomes are read the same way.
      const result: DownloadClientTestResult = res.ok
        ? ((await res.json()) as DownloadClientTestResult)
        : { success: false, error: (await toFailure(res)).message ?? undefined }
      // The server stamps the row either way, so the card is refreshed either way: that stamp is
      // where the reason is kept once this toast is gone.
      await fetchClients({ silent: true })
      return result
    } catch {
      return { success: false }
    }
  }

  /** The mapping is named by id: the server probes the directory it stored, never one sent to it. */
  async function testPathMapping(id: number, mappingId: number): Promise<PathMappingHardlinkTestResult> {
    const unavailable = { localPathExists: false, bookDockPathExists: false, hardlinkWorks: false }
    try {
      const res = await api(`${BASE_PATH}/${id}/test-path-mapping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mappingId }),
      })
      if (!res.ok) return { ...unavailable, error: (await toFailure(res)).message ?? undefined }
      return (await res.json()) as PathMappingHardlinkTestResult
    } catch {
      return unavailable
    }
  }

  async function reconcile(id: number): Promise<DownloadClientFailure | null> {
    markReconciling(id, true)
    try {
      const res = await api(`${BASE_PATH}/${id}/reconciliation`)
      if (!res.ok) return await toFailure(res)
      reconciliation.value = { ...reconciliation.value, [id]: (await res.json()) as DownloadClientReconciliationResult }
      return null
    } catch {
      return NETWORK_FAILURE
    } finally {
      markReconciling(id, false)
    }
  }

  async function adopt(clientId: number, infoHash: string, downloadId: number): Promise<DownloadClientFailure | null> {
    markReconciling(clientId, true)
    try {
      const res = await api(`${BASE_PATH}/${clientId}/reconciliation/${encodeURIComponent(infoHash)}/adopt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ downloadId }),
      })
      if (!res.ok) return await toFailure(res)
      return await reconcile(clientId)
    } catch {
      return NETWORK_FAILURE
    } finally {
      markReconciling(clientId, false)
    }
  }

  async function removeOrphan(clientId: number, infoHash: string): Promise<DownloadClientFailure | null> {
    markReconciling(clientId, true)
    try {
      const res = await api(`${BASE_PATH}/${clientId}/reconciliation/${encodeURIComponent(infoHash)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteFiles: false }),
      })
      if (!res.ok) return await toFailure(res)
      return await reconcile(clientId)
    } catch {
      return NETWORK_FAILURE
    } finally {
      markReconciling(clientId, false)
    }
  }

  return {
    clients,
    encryptionConfigured,
    loading,
    saving,
    loadFailed,
    reconciliation,
    reconcilingIds,
    fetchClients,
    save,
    remove,
    test,
    testPathMapping,
    reconcile,
    adopt,
    removeOrphan,
  }
}

/**
 * The fulfiller-facing half: names and ids only. Kept separate from `useDownloadClients` because
 * reading the list does not imply permission to manage the rows, and the requests page must not
 * 403 its way into an empty client list. Which endpoint serves it depends on whether the viewer
 * moderates the queue or only fulfils their own.
 */
export function useDownloadClientSummaries(canManage: () => boolean) {
  const basePath = () => fulfilmentBase(canManage())
  const clients = ref<DownloadClientSummary[]>([])
  const loadFailed = ref(false)

  async function fetchClients(): Promise<void> {
    loadFailed.value = false
    try {
      const res = await api(`${basePath()}/download-clients`)
      if (!res.ok) {
        loadFailed.value = true
        return
      }
      clients.value = (await res.json()) as DownloadClientSummary[]
    } catch {
      loadFailed.value = true
    }
  }

  return { clients, loadFailed, fetchClients }
}
