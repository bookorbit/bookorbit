import { computed, ref } from 'vue'
import { api } from '@/lib/api'
import { createCoalescedFetch, createRequestGeneration } from '@/lib/async'
import type { BookSelectionPayload, Collection, CreateCollectionPayload, MediaType, PodcastListItem, PodcastPage } from '@bookorbit/types'

const collections = ref<Collection[]>([])
const loaded = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const listGeneration = createRequestGeneration()

const loadCollectionList = createCoalescedFetch(async (): Promise<void> => {
  loading.value = true
  error.value = null
  const generation = listGeneration.current()
  try {
    const res = await api('/api/v1/collections')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const nextCollections: Collection[] = await res.json()
    if (!listGeneration.isCurrent(generation)) return
    collections.value = nextCollections
    loaded.value = true
  } catch (e: unknown) {
    if (!listGeneration.isCurrent(generation)) return
    error.value = e instanceof Error ? e.message : 'Failed to load collections'
  } finally {
    if (listGeneration.isCurrent(generation)) loading.value = false
  }
})

const fetchCollectionPodcastPage = createCoalescedFetch(
  async (path: string): Promise<PodcastPage<PodcastListItem>> => {
    const res = await api(path)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json() as Promise<PodcastPage<PodcastListItem>>
  },
  (path) => path,
)

export function resetCollections(): void {
  listGeneration.invalidate()
  collections.value = []
  loaded.value = false
  loading.value = false
  error.value = null
  loadCollectionList.clear()
  fetchCollectionPodcastPage.clear()
}

/** The list endpoint returns every medium; each surface picks the one it renders. */
const bookCollections = computed(() => collections.value.filter((collection) => collection.mediaType !== 'podcasts'))
const podcastCollections = computed(() => collections.value.filter((collection) => collection.mediaType === 'podcasts'))

export function useCollections() {
  async function fetchCollections(): Promise<void> {
    if (loaded.value) return
    return loadCollectionList()
  }

  /** Forces a re-fetch after any in-flight list request finishes. */
  async function refreshCollections(): Promise<void> {
    return loadCollectionList()
  }

  async function fetchCollectionsWithMembership(selectionPayload: BookSelectionPayload): Promise<Collection[]> {
    const res = await api('/api/v1/collections/membership', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(selectionPayload),
    })
    if (!res.ok) throw new Error('Failed to fetch collections')
    return res.json()
  }

  async function createCollection(
    name: string,
    icon: string,
    description?: string,
    isPublicOrMediaType?: boolean | MediaType,
    explicitMediaType?: MediaType,
  ): Promise<Collection> {
    const isPublic = typeof isPublicOrMediaType === 'boolean' ? isPublicOrMediaType : undefined
    const mediaType = typeof isPublicOrMediaType === 'string' ? isPublicOrMediaType : explicitMediaType
    const payload: CreateCollectionPayload = {
      name,
      icon,
      description,
      ...(isPublic !== undefined && { isPublic }),
      ...(mediaType !== undefined && { mediaType }),
    }
    const res = await api('/api/v1/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error('Failed to create collection')
    const created: Collection = await res.json()
    collections.value = [...collections.value, created]
    return created
  }

  async function updateCollection(id: number, name: string, icon: string, syncToKobo?: boolean, isPublic?: boolean): Promise<Collection> {
    const res = await api(`/api/v1/collections/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        icon,
        ...(syncToKobo !== undefined && { syncToKobo }),
        ...(isPublic !== undefined && { isPublic }),
      }),
    })
    if (!res.ok) throw new Error('Failed to update collection')
    const updated: Collection = await res.json()
    collections.value = collections.value.map((c) => (c.id === id ? updated : c))
    return updated
  }

  async function addBooksToCollection(collectionId: number, selectionPayload: BookSelectionPayload): Promise<Collection> {
    const res = await api(`/api/v1/collections/${collectionId}/books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(selectionPayload),
    })
    if (!res.ok) throw new Error('Failed to add books to collection')
    const updated: Collection = await res.json()
    collections.value = collections.value.map((c) => (c.id === collectionId ? updated : c))
    return updated
  }

  async function removeBooksFromCollection(collectionId: number, selectionPayload: BookSelectionPayload): Promise<Collection> {
    const res = await api(`/api/v1/collections/${collectionId}/books`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(selectionPayload),
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

  async function fetchCollectionPodcasts(id: number, page = 0, size = 50): Promise<PodcastPage<PodcastListItem>> {
    const params = new URLSearchParams({ page: String(page), size: String(size) })
    return fetchCollectionPodcastPage(`/api/v1/collections/${id}/podcasts?${params.toString()}`)
  }

  /**
   * A collection's stored count is a snapshot; paging its shows is the freshest count anyone has.
   * Reconciling here keeps the sidebar badge honest without a view reaching into this cache.
   */
  function applyCollectionPodcastCount(id: number, podcastCount: number): void {
    const collection = collections.value.find((candidate) => candidate.id === id)
    if (collection) collection.podcastCount = Math.max(0, podcastCount)
  }

  /** One request instead of one per collection, so opening the sheet stays cheap at scale. */
  async function fetchPodcastCollectionMembership(podcastId: number): Promise<Collection[]> {
    const res = await api(`/api/v1/collections/podcast-membership?podcastId=${podcastId}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }

  async function addPodcastsToCollection(id: number, podcastIds: number[]): Promise<void> {
    const res = await api(`/api/v1/collections/${id}/podcasts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ podcastIds }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  }

  async function removePodcastsFromCollection(id: number, podcastIds: number[]): Promise<void> {
    const res = await api(`/api/v1/collections/${id}/podcasts`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ podcastIds }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  }

  return {
    collections,
    bookCollections,
    podcastCollections,
    fetchCollectionPodcasts,
    applyCollectionPodcastCount,
    fetchPodcastCollectionMembership,
    addPodcastsToCollection,
    removePodcastsFromCollection,
    loaded,
    loading,
    error,
    fetchCollections,
    refreshCollections,
    fetchCollectionsWithMembership,
    createCollection,
    updateCollection,
    addBooksToCollection,
    removeBooksFromCollection,
    reorderCollections,
    deleteCollection,
  }
}
