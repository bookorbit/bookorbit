import { ref } from 'vue'
import { api } from '@/lib/api'
import type { Collection } from '@projectx/types'

const collections = ref<Collection[]>([])

export function useCollections() {
  async function fetchCollections() {
    const res = await api('/api/v1/collections')
    if (!res.ok) throw new Error('Failed to fetch collections')
    collections.value = await res.json()
  }

  async function fetchCollectionsWithMembership(bookIds: number[]): Promise<Collection[]> {
    const res = await api(`/api/v1/collections?bookIds=${bookIds.join(',')}`)
    if (!res.ok) throw new Error('Failed to fetch collections')
    return res.json()
  }

  async function createCollection(name: string, icon?: string, description?: string): Promise<Collection> {
    const res = await api('/api/v1/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, icon: icon || undefined, description }),
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

  return {
    collections,
    fetchCollections,
    fetchCollectionsWithMembership,
    createCollection,
    updateCollection,
    addBooksToCollection,
    removeBooksFromCollection,
  }
}
