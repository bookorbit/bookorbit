import { ref } from 'vue'
import { api } from '@/lib/api'
import { apiError } from '@/lib/api-json'
import { createCoalescedFetch, createRequestGeneration } from '@/lib/async'
import type { CreateSmartScopePayload, SmartScope } from '@bookorbit/types'

const smartScopes = ref<SmartScope[]>([])
const loaded = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const listGeneration = createRequestGeneration()

const loadSmartScopeList = createCoalescedFetch(async (): Promise<void> => {
  loading.value = true
  error.value = null
  const generation = listGeneration.current()
  try {
    const res = await api('/api/v1/smart-scopes')
    if (!res.ok) throw await apiError(res, 'smartScope.errors.load')
    const nextSmartScopes: SmartScope[] = await res.json()
    if (!listGeneration.isCurrent(generation)) return
    smartScopes.value = nextSmartScopes
    loaded.value = true
  } catch (e: unknown) {
    if (!listGeneration.isCurrent(generation)) return
    error.value = e instanceof Error ? e.message : 'Failed to load smart scopes'
  } finally {
    if (listGeneration.isCurrent(generation)) loading.value = false
  }
})

export function resetSmartScopes(): void {
  listGeneration.invalidate()
  smartScopes.value = []
  loaded.value = false
  loading.value = false
  error.value = null
  loadSmartScopeList.clear()
}

export function useSmartScopes() {
  async function fetchSmartScopes(): Promise<void> {
    if (loaded.value) return
    return loadSmartScopeList()
  }

  async function refreshSmartScopes(): Promise<void> {
    return loadSmartScopeList()
  }

  async function createSmartScope(payload: CreateSmartScopePayload): Promise<SmartScope> {
    const res = await api('/api/v1/smart-scopes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw await apiError(res, 'smartScope.errors.save')
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
    if (!res.ok) throw await apiError(res, 'smartScope.errors.save')
    const updated: SmartScope = await res.json()
    smartScopes.value = smartScopes.value.map((l) => (l.id === id ? updated : l))
    return updated
  }

  async function setKoboSync(id: number, enabled: boolean): Promise<SmartScope> {
    const res = await api(`/api/v1/smart-scopes/${id}/kobo-sync`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    if (!res.ok) throw await apiError(res, 'smartScope.errors.koboSync')
    const updated: SmartScope = await res.json()
    smartScopes.value = smartScopes.value.map((l) => (l.id === id ? { ...l, ...updated } : l))
    return updated
  }

  async function deleteSmartScope(id: number): Promise<void> {
    const res = await api(`/api/v1/smart-scopes/${id}`, { method: 'DELETE' })
    if (!res.ok) throw await apiError(res, 'smartScope.errors.delete')
    smartScopes.value = smartScopes.value.filter((l) => l.id !== id)
  }

  async function reorderSmartScopes(order: { id: number; displayOrder: number }[]): Promise<void> {
    const res = await api('/api/v1/smart-scopes/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order }),
    })
    if (!res.ok) throw await apiError(res, 'smartScope.errors.reorder')
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
    setKoboSync,
    deleteSmartScope,
    reorderSmartScopes,
  }
}
