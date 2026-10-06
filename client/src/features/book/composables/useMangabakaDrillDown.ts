import { ref } from 'vue'
import { api } from '@/lib/api'
import type { MangabakaCollectionSummary, MetadataCandidate } from '@bookorbit/types'

const expandedSeries = ref<Set<string>>(new Set())
const collectionsBySeries = ref<Map<string, MangabakaCollectionSummary[]>>(new Map())
const expandedCollections = ref<Set<string>>(new Set())
const worksByCollection = ref<Map<string, MetadataCandidate[]>>(new Map())
const loadingSeries = ref<Set<string>>(new Set())
const loadingCollections = ref<Set<string>>(new Set())
const seriesErrors = ref<Map<string, string>>(new Map())
const collectionErrors = ref<Map<string, string>>(new Map())
const highlightedVolume = ref<number | null>(null)

const seriesInflight = new Map<string, Promise<void>>()
const collectionInflight = new Map<string, Promise<void>>()

export function useMangabakaDrillDown() {
  function isSeriesExpanded(providerId: string): boolean {
    return expandedSeries.value.has(providerId)
  }

  function isCollectionExpanded(providerId: string, collectionId: string): boolean {
    return expandedCollections.value.has(`${providerId}:${collectionId}`)
  }

  function isLoadingSeries(providerId: string): boolean {
    return loadingSeries.value.has(providerId)
  }

  function isLoadingCollection(providerId: string, collectionId: string): boolean {
    return loadingCollections.value.has(`${providerId}:${collectionId}`)
  }

  function clearSeriesError(providerId: string): void {
    if (!seriesErrors.value.has(providerId)) return
    const next = new Map(seriesErrors.value)
    next.delete(providerId)
    seriesErrors.value = next
  }

  function setSeriesError(providerId: string, message: string): void {
    const next = new Map(seriesErrors.value)
    next.set(providerId, message)
    seriesErrors.value = next
  }

  function clearCollectionError(collectionId: string): void {
    if (!collectionErrors.value.has(collectionId)) return
    const next = new Map(collectionErrors.value)
    next.delete(collectionId)
    collectionErrors.value = next
  }

  function setCollectionError(collectionId: string, message: string): void {
    const next = new Map(collectionErrors.value)
    next.set(collectionId, message)
    collectionErrors.value = next
  }

  function markSeriesLoading(providerId: string, loading: boolean): void {
    const next = new Set(loadingSeries.value)
    if (loading) next.add(providerId)
    else next.delete(providerId)
    loadingSeries.value = next
  }

  function markCollectionLoading(providerId: string, collectionId: string, loading: boolean): void {
    const key = `${providerId}:${collectionId}`
    const next = new Set(loadingCollections.value)
    if (loading) next.add(key)
    else next.delete(key)
    loadingCollections.value = next
  }

  function setCollections(providerId: string, collections: MangabakaCollectionSummary[]): void {
    const next = new Map(collectionsBySeries.value)
    next.set(providerId, collections)
    collectionsBySeries.value = next
  }

  function setWorks(collectionId: string, works: MetadataCandidate[]): void {
    const next = new Map(worksByCollection.value)
    next.set(collectionId, works)
    worksByCollection.value = next
  }

  async function fetchSeriesCollections(providerId: string, seriesId: number): Promise<void> {
    const existing = seriesInflight.get(providerId)
    if (existing) return existing

    const promise = (async () => {
      clearSeriesError(providerId)
      markSeriesLoading(providerId, true)
      try {
        const res = await api(`/api/v1/metadata-fetch/mangabaka/series/${seriesId}/collections`)
        if (!res.ok) {
          const message = await extractErrorMessage(res, 'Failed to load series collections')
          setSeriesError(providerId, message)
          return
        }

        const collections = (await res.json()) as MangabakaCollectionSummary[]
        setCollections(providerId, collections)

        const nextExpanded = new Set(expandedSeries.value)
        nextExpanded.add(providerId)
        expandedSeries.value = nextExpanded
      } finally {
        markSeriesLoading(providerId, false)
        seriesInflight.delete(providerId)
      }
    })()

    seriesInflight.set(providerId, promise)
    return promise
  }

  async function fetchCollectionWorks(providerId: string, collectionId: string, seriesId: number): Promise<void> {
    const key = `${providerId}:${collectionId}`

    const existing = collectionInflight.get(key)
    if (existing) return existing

    const promise = (async () => {
      clearCollectionError(collectionId)
      markCollectionLoading(providerId, collectionId, true)
      try {
        const res = await api(`/api/v1/metadata-fetch/mangabaka/collections/${collectionId}/works?seriesId=${seriesId}`)
        if (!res.ok) {
          const message = await extractErrorMessage(res, 'Failed to load collection works')
          setCollectionError(collectionId, message)
          return
        }

        const works = (await res.json()) as MetadataCandidate[]
        setWorks(collectionId, works)

        const nextExpanded = new Set(expandedCollections.value)
        nextExpanded.add(key)
        expandedCollections.value = nextExpanded
      } finally {
        markCollectionLoading(providerId, collectionId, false)
        collectionInflight.delete(key)
      }
    })()

    collectionInflight.set(key, promise)
    return promise
  }

  async function expandSeries(providerId: string, seriesId: number): Promise<void> {
    if (isSeriesExpanded(providerId)) {
      collapseSeries(providerId)
      return
    }

    if (collectionsBySeries.value.has(providerId)) {
      const nextExpanded = new Set(expandedSeries.value)
      nextExpanded.add(providerId)
      expandedSeries.value = nextExpanded
      return
    }

    return fetchSeriesCollections(providerId, seriesId)
  }

  function collapseSeries(providerId: string): void {
    const nextExpanded = new Set(expandedSeries.value)
    nextExpanded.delete(providerId)
    expandedSeries.value = nextExpanded
  }

  async function expandCollection(providerId: string, collectionId: string, seriesId: number): Promise<void> {
    if (isCollectionExpanded(providerId, collectionId)) {
      collapseCollection(providerId, collectionId)
      return
    }

    if (worksByCollection.value.has(collectionId)) {
      const nextExpanded = new Set(expandedCollections.value)
      nextExpanded.add(`${providerId}:${collectionId}`)
      expandedCollections.value = nextExpanded
      return
    }

    return fetchCollectionWorks(providerId, collectionId, seriesId)
  }

  function collapseCollection(providerId: string, collectionId: string): void {
    const key = `${providerId}:${collectionId}`
    const nextExpanded = new Set(expandedCollections.value)
    nextExpanded.delete(key)
    expandedCollections.value = nextExpanded
  }

  async function retrySeries(providerId: string, seriesId: number): Promise<void> {
    collapseSeries(providerId)
    return expandSeries(providerId, seriesId)
  }

  async function retryCollection(providerId: string, collectionId: string, seriesId: number): Promise<void> {
    collapseCollection(providerId, collectionId)
    return expandCollection(providerId, collectionId, seriesId)
  }

  function reset(): void {
    expandedSeries.value = new Set()
    expandedCollections.value = new Set()
    seriesErrors.value = new Map()
    collectionErrors.value = new Map()
    seriesInflight.clear()
    collectionInflight.clear()
  }

  return {
    expandedSeries,
    collectionsBySeries,
    expandedCollections,
    worksByCollection,
    loadingSeries,
    loadingCollections,
    seriesErrors,
    collectionErrors,
    highlightedVolume,
    expandSeries,
    collapseSeries,
    expandCollection,
    collapseCollection,
    retrySeries,
    retryCollection,
    isSeriesExpanded,
    isCollectionExpanded,
    isLoadingSeries,
    isLoadingCollection,
    reset,
  }
}

export type MangabakaDrillDown = ReturnType<typeof useMangabakaDrillDown>

async function extractErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string; error?: string }
    return body.message ?? body.error ?? fallback
  } catch {
    return fallback
  }
}
