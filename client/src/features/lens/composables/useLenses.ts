import { ref } from 'vue'
import { api } from '@/lib/api'
import type { CreateLensPayload, Lens } from '@projectx/types'

const lenses = ref<Lens[]>([])
const loaded = ref(false)

export function useLenses() {
  async function fetchLenses() {
    if (loaded.value) return
    const res = await api('/api/v1/lenses')
    if (!res.ok) return
    lenses.value = await res.json()
    loaded.value = true
  }

  async function refreshLenses() {
    const res = await api('/api/v1/lenses')
    if (!res.ok) return
    lenses.value = await res.json()
    loaded.value = true
  }

  async function createLens(payload: CreateLensPayload): Promise<Lens> {
    const res = await api('/api/v1/lenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const lens: Lens = await res.json()
    lenses.value.push(lens)
    return lens
  }

  async function updateLens(id: number, payload: Partial<CreateLensPayload>): Promise<Lens> {
    const res = await api(`/api/v1/lenses/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const updated: Lens = await res.json()
    const idx = lenses.value.findIndex((l) => l.id === id)
    if (idx !== -1) lenses.value[idx] = updated
    return updated
  }

  async function deleteLens(id: number): Promise<void> {
    const res = await api(`/api/v1/lenses/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    lenses.value = lenses.value.filter((l) => l.id !== id)
  }

  async function reorderLenses(order: { id: number; displayOrder: number }[]): Promise<void> {
    const res = await api('/api/v1/lenses/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  }

  return { lenses, fetchLenses, refreshLenses, createLens, updateLens, deleteLens, reorderLenses }
}
