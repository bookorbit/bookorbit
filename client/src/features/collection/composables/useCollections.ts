import { ref } from 'vue'
import { api } from '@/lib/api'
import type { Collection } from '@bookorbit/types'

const collections = ref<Collection[]>([])
const loaded = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
let fetchPromise: Promise<void> | null = null

export function useCollections() {
  async function fetchCollections(): Promise<void> {
    if (loaded.value) return
    if (fetchPromise) return fetchPromise
    loading.value = true
    error.value = null
    fetchPromise = api('/api/v1/collections')
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        collections.value = await res.json()
        loaded.value = true
      })
      .catch((e: unknown) => {
        error.value = e instanceof Error ? e.message : 'Failed to load collections'
      })
      .finally(() => {
        loading.value = false
        fetchPromise = null
      })
    return fetchPromise
  }

  async function fetchCollectionsWithMembership(bookIds: number[]): Promise<Collection[]> {
    const res = await api(`/api/v1/collections?bookIds=${bookIds.join(',')}`)
    if (!res.ok) throw new Error('Failed to fetch collections')
    return res.json()
  }

  async function createCollection(name: string, icon: string, description?: string): Promise<Collection> {
    const res = await api('/api/v1/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, icon, description }),
    })
    if (!res.ok) throw new Error('Failed to create collection')
    const created: Collection = await res.json()
    collections.value = [...collections.value, created]
    return created
  }

  async function updateCollection(id: number, name: string, icon: string, syncToKobo?: boolean): Promise<Collection> {
    const res = await api(`/api/v1/collections/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, icon, ...(syncToKobo !== undefined && { syncToKobo }) }),
    })
    if (!res.ok) throw new Error('Failed to update collection')
    const updated: Collection = await res.json()
    collections.value = collections.value.map((c) => (c.id === id ? updated : c))
    return updated
  }

  async function addBooksToCollection(collectionId: number, bookIds: number[]): Promise<Collection> {
    const res = await api(`/api/v1/collections/${collectionId}/books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookIds }),
    })
    if (!res.ok) throw new Error('Failed to add books to collection')
    const updated: Collection = await res.json()
    collections.value = collections.value.map((c) => (c.id === collectionId ? updated : c))
    return updated
  }

  async function removeBooksFromCollection(collectionId: number, bookIds: number[]): Promise<Collection> {
    const res = await api(`/api/v1/collections/${collectionId}/books`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookIds }),
    })
    if (!res.ok) throw new Error('Failed to remove books from collection')
    const updated: Collection = await res.json()
    collections.value = collections.value.map((c) => (c.id === collectionId ? updated : c))
    return updated
  }

  async function reorderCollections(order: { id: number; displayOrder: number }[]): Promise<void> {
    const res = await api('/api/v1/collections/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order }),
    })
    if (!res.ok) throw new Error('Failed to reorder collections')
  }

  async function deleteCollection(id: number): Promise<void> {
    const res = await api(`/api/v1/collections/${id}`, {
      method: 'DELETE',
    })
    if (!res.ok) throw new Error('Failed to delete collection')
    collections.value = collections.value.filter((collection) => collection.id !== id)
  }

  return {
    collections,
    loaded,
    loading,
    error,
    fetchCollections,
    fetchCollectionsWithMembership,
    createCollection,
    updateCollection,
    addBooksToCollection,
    removeBooksFromCollection,
    reorderCollections,
    deleteCollection,
  }
}
