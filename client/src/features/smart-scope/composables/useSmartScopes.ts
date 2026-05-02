import { ref } from 'vue'
import { api } from '@/lib/api'
import type { CreateSmartScopePayload, SmartScope } from '@bookorbit/types'

const smartScopes = ref<SmartScope[]>([])
const loaded = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
let fetchPromise: Promise<void> | null = null

export function useSmartScopes() {
  async function fetchSmartScopes() {
    if (loaded.value) return
    if (fetchPromise) return fetchPromise
    loading.value = true
    error.value = null
    fetchPromise = api('/api/v1/smart-scopes')
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        smartScopes.value = await res.json()
        loaded.value = true
      })
      .catch((e: unknown) => {
        error.value = e instanceof Error ? e.message : 'Failed to load smart scopes'
      })
      .finally(() => {
        loading.value = false
        fetchPromise = null
      })
    return fetchPromise
  }

  async function refreshSmartScopes() {
    loading.value = true
    error.value = null
    try {
      const res = await api('/api/v1/smart-scopes')
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      smartScopes.value = await res.json()
      loaded.value = true
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Failed to load smart scopes'
    } finally {
      loading.value = false
    }
  }

  async function createSmartScope(payload: CreateSmartScopePayload): Promise<SmartScope> {
    const res = await api('/api/v1/smart-scopes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const smartScope: SmartScope = await res.json()
    smartScopes.value = [...smartScopes.value, smartScope]
    return smartScope
  }

  async function updateSmartScope(id: number, payload: Partial<CreateSmartScopePayload>): Promise<SmartScope> {
    const res = await api(`/api/v1/smart-scopes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const updated: SmartScope = await res.json()
    smartScopes.value = smartScopes.value.map((l) => (l.id === id ? updated : l))
    return updated
  }

  async function deleteSmartScope(id: number): Promise<void> {
    const res = await api(`/api/v1/smart-scopes/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    smartScopes.value = smartScopes.value.filter((l) => l.id !== id)
  }

  async function reorderSmartScopes(order: { id: number; displayOrder: number }[]): Promise<void> {
    const res = await api('/api/v1/smart-scopes/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  }

  return {
    smartScopes,
    loaded,
    loading,
    error,
    fetchSmartScopes,
    refreshSmartScopes,
    createSmartScope,
    updateSmartScope,
    deleteSmartScope,
    reorderSmartScopes,
  }
}
