import { ref } from 'vue'
import { api } from '@/lib/api'
import type {
  CreateIndexerPayload,
  IndexerAdapterDescriptor,
  IndexerAdapterListResult,
  IndexerErrorCode,
  IndexerItem,
  IndexerListResult,
  IndexerPluginFailure,
  IndexerTestResult,
  PluginInspection,
  PluginInstallResult,
  UpdateIndexerPayload,
} from '@bookorbit/types'

const BASE_PATH = '/api/v1/admin/request-indexers'

/**
 * A failed call reports a stable code when the server sent one, so the page can say what went
 * wrong in the reader's own language rather than forwarding an English sentence.
 */
export interface IndexerFailure {
  errorCode: IndexerErrorCode | null
  message: string | null
}

const NETWORK_FAILURE: IndexerFailure = { errorCode: null, message: null }

async function toFailure(res: Response): Promise<IndexerFailure> {
  try {
    const body = (await res.json()) as { message?: string | string[]; errorCode?: string }
    const message = Array.isArray(body.message) ? (body.message[0] ?? null) : (body.message ?? null)
    return { errorCode: (body.errorCode as IndexerErrorCode | undefined) ?? null, message }
  } catch {
    return { errorCode: null, message: null }
  }
}

export function useIndexers() {
  const indexers = ref<IndexerItem[]>([])
  /**
   * What this install can offer, read at runtime rather than compiled in: an adapter loaded from
   * the plugin directory is not knowable at build time.
   */
  const adapters = ref<IndexerAdapterDescriptor[]>([])
  /** Plugins that would not load. Shown, because one that silently vanishes cannot be debugged. */
  const pluginFailures = ref<IndexerPluginFailure[]>([])
  /** False when `BOOK_REQUEST_ENCRYPTION_KEY` is unset, which is what refuses a saved credential. */
  const encryptionConfigured = ref(true)
  const loading = ref(false)
  const saving = ref(false)
  const loadFailed = ref(false)

  /**
   * `silent` refreshes the list without blanking the panel. The loading flag swaps the whole
   * section for a spinner, which after a test or a save reads as the page reloading and throws
   * away the reader's scroll position, so it is only for the first load.
   *
   * `withAdapters` follows `silent` because which adapters exist is fixed for the life of the
   * process, so a refresh after testing or saving a row has nothing to learn from asking again.
   * Installing or removing a plugin is the exception: it changes the adapter list itself, and it
   * is the one refresh that must not blank the panel it was started from.
   */
  async function fetchIndexers({ silent = false, withAdapters = !silent }: { silent?: boolean; withAdapters?: boolean } = {}): Promise<void> {
    if (!silent) loading.value = true
    loadFailed.value = false
    try {
      const res = await api(BASE_PATH)
      if (!res.ok) {
        loadFailed.value = true
        return
      }
      const result = (await res.json()) as IndexerListResult
      indexers.value = result.indexers
      encryptionConfigured.value = result.encryptionConfigured
      if (withAdapters) await fetchAdapters()
    } catch {
      loadFailed.value = true
    } finally {
      loading.value = false
    }
  }

  async function fetchAdapters(): Promise<void> {
    const res = await api(`${BASE_PATH}/adapters`)
    if (!res.ok) {
      loadFailed.value = true
      return
    }
    const result = (await res.json()) as IndexerAdapterListResult
    adapters.value = result.adapters
    pluginFailures.value = result.pluginFailures
  }

  /** Undefined for a row whose adapter this build no longer provides, which the panel says. */
  function adapterFor(type: string): IndexerAdapterDescriptor | undefined {
    return adapters.value.find((adapter) => adapter.type === type)
  }

  async function save(id: number | null, payload: CreateIndexerPayload | UpdateIndexerPayload): Promise<IndexerFailure | null> {
    saving.value = true
    try {
      const res = await api(id === null ? BASE_PATH : `${BASE_PATH}/${id}`, {
        method: id === null ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) return await toFailure(res)
      await fetchIndexers({ silent: true })
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
      await fetchIndexers({ silent: true })
      return true
    } catch {
      return false
    } finally {
      saving.value = false
    }
  }

  async function test(id: number): Promise<IndexerTestResult> {
    try {
      const res = await api(`${BASE_PATH}/${id}/test`, { method: 'POST' })
      // A failed test answers 502 carrying its reason, so both outcomes are read the same way.
      const result: IndexerTestResult = res.ok
        ? ((await res.json()) as IndexerTestResult)
        : { success: false, error: (await toFailure(res)).message ?? undefined }
      // The server stamps the row either way, so the card is refreshed either way: that stamp is
      // where the reason is kept once this toast is gone.
      await fetchIndexers({ silent: true })
      return result
    } catch {
      return { success: false }
    }
  }

  /**
   * Reads an uploaded plugin without installing it. The server runs it in a process of its own and
   * reports only what it declares, so this is a look rather than a commitment.
   */
  async function inspectPlugin(file: File): Promise<{ inspection: PluginInspection | null; error: string | null }> {
    return sendPlugin<PluginInspection>(`${BASE_PATH}/plugins/inspect`, file)
  }

  /**
   * The same file again rather than a token for the one just inspected, so the bytes that were
   * reviewed and the bytes that land are the same by construction.
   */
  async function installPlugin(file: File): Promise<{ inspection: PluginInstallResult | null; error: string | null }> {
    return sendPlugin<PluginInstallResult>(`${BASE_PATH}/plugins`, file)
  }

  async function sendPlugin<T extends PluginInspection>(url: string, file: File): Promise<{ inspection: T | null; error: string | null }> {
    const body = new FormData()
    body.append('file', file)
    try {
      const res = await api(url, { method: 'POST', body })
      if (!res.ok) return { inspection: null, error: (await toFailure(res)).message }
      return { inspection: (await res.json()) as T, error: null }
    } catch {
      return { inspection: null, error: null }
    }
  }

  async function removePlugin(type: string): Promise<boolean> {
    try {
      const res = await api(`${BASE_PATH}/plugins/${encodeURIComponent(type)}`, { method: 'DELETE' })
      return res.ok
    } catch {
      return false
    }
  }

  return {
    indexers,
    adapters,
    pluginFailures,
    adapterFor,
    encryptionConfigured,
    loading,
    saving,
    loadFailed,
    fetchIndexers,
    save,
    remove,
    test,
    inspectPlugin,
    installPlugin,
    removePlugin,
  }
}
