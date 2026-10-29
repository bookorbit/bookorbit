import { ref, shallowReactive } from 'vue'
import type {
  CreateFolderResult,
  FolderInspection,
  FolderListing,
  FolderPlaces,
  FolderSearchResult,
  FolderSummary,
  UnclaimedFolders,
} from '@bookorbit/types'
import { api } from '@/lib/api'
import { normalizeFolderPath } from '../folder-paths'
import { isAtOrInside } from './folder-picker-rules'

/** Rows that scroll into view within this window share one request. */
const SUMMARY_BATCH_DELAY_MS = 40
const SUMMARY_BATCH_SIZE = 100
/** A folder the server ran out of time for is asked for again, a few times, a little later each time. */
const PENDING_RETRY_MS = 300
const PENDING_RETRIES = 5
/** Each inspection walks a folder and sizes its files, so only a few run at once. */
const INSPECTION_CONCURRENCY = 3

export type CreateFolderError = 'exists' | 'denied' | 'invalid' | 'failed'

/**
 * Everything the folder picker reads from the server, cached for the life of the dialog. Requests
 * are deduplicated, and counts for visible rows are batched.
 */
export function useFolderPickerData() {
  const places = ref<FolderPlaces | null>(null)
  const placesFailed = ref(false)
  const unclaimed = ref<UnclaimedFolders | null>(null)
  const listings = shallowReactive(new Map<string, FolderListing>())
  const summaries = shallowReactive(new Map<string, FolderSummary>())
  const inspections = shallowReactive(new Map<string, FolderInspection>())
  const pendingListings = new Map<string, Promise<FolderListing | null>>()
  const pendingInspections = new Map<string, Promise<FolderInspection | null>>()
  const requestedSummaries = new Set<string>()
  const pendingRetries = new Map<string, number>()
  /** Folders whose inspection failed, so the preview stops waiting for it. */
  const failedInspections = shallowReactive(new Set<string>())
  let summaryQueue: string[] = []
  let disposed = false
  let summaryTimer: ReturnType<typeof setTimeout> | null = null
  let inspecting = 0
  const inspectionQueue: Array<() => void> = []

  async function loadPlaces() {
    try {
      const response = await api('/api/v1/path/places')
      if (!response.ok) throw new Error(String(response.status))
      places.value = await response.json()
      placesFailed.value = false
    } catch {
      placesFailed.value = true
    }
  }

  function ensureListing(path: string): Promise<FolderListing | null> {
    const key = normalizeFolderPath(path)
    const known = listings.get(key)
    if (known) return Promise.resolve(known)
    const pending = pendingListings.get(key)
    if (pending) return pending
    const request = (async () => {
      try {
        const response = await api(`/api/v1/path/listing?path=${encodeURIComponent(key)}`)
        const listing: FolderListing = response.ok
          ? await response.json()
          : { path: key, state: response.status === 403 ? 'blocked' : 'missing', entries: [], truncated: false }
        listings.set(key, listing)
        return listing
      } catch {
        return null
      } finally {
        pendingListings.delete(key)
      }
    })()
    pendingListings.set(key, request)
    return request
  }

  function requestSummaries(paths: string[]) {
    for (const path of paths) {
      const key = normalizeFolderPath(path)
      if (summaries.has(key) || requestedSummaries.has(key)) continue
      requestedSummaries.add(key)
      summaryQueue.push(key)
    }
    if (summaryQueue.length > 0 && !summaryTimer) summaryTimer = setTimeout(flushSummaries, SUMMARY_BATCH_DELAY_MS)
  }

  async function flushSummaries() {
    summaryTimer = null
    const queue = summaryQueue
    summaryQueue = []
    for (let i = 0; i < queue.length; i += SUMMARY_BATCH_SIZE) {
      const batch = queue.slice(i, i + SUMMARY_BATCH_SIZE)
      try {
        const response = await api('/api/v1/path/summaries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths: batch }),
        })
        if (!response.ok) throw new Error(String(response.status))
        const results: FolderSummary[] = await response.json()
        for (const summary of results) {
          const key = normalizeFolderPath(summary.path)
          if (summary.state === 'pending') retryLater(key)
          else summaries.set(key, summary)
        }
      } catch {
        // Unanswered paths may be asked for again when they next scroll into view.
        for (const path of batch) requestedSummaries.delete(path)
      }
    }
  }

  function retryLater(path: string) {
    requestedSummaries.delete(path)
    const attempt = (pendingRetries.get(path) ?? 0) + 1
    pendingRetries.set(path, attempt)
    if (attempt > PENDING_RETRIES) return
    setTimeout(() => {
      if (!disposed) requestSummaries([path])
    }, PENDING_RETRY_MS * attempt)
  }

  /** Counts for `paths` now, for a decision that cannot wait for rows to scroll into view. */
  async function summariesFor(paths: string[]): Promise<Map<string, FolderSummary>> {
    const keys = [...new Set(paths.map(normalizeFolderPath))]
    const missing = keys.filter((key) => !summaries.has(key))
    for (let i = 0; i < missing.length; i += SUMMARY_BATCH_SIZE) {
      const batch = missing.slice(i, i + SUMMARY_BATCH_SIZE)
      try {
        const response = await api('/api/v1/path/summaries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths: batch }),
        })
        if (!response.ok) continue
        const results: FolderSummary[] = await response.json()
        for (const summary of results) if (summary.state !== 'pending') summaries.set(normalizeFolderPath(summary.path), summary)
      } catch {
        // Missing answers count as unknown.
      }
    }
    return new Map(keys.flatMap((key) => (summaries.has(key) ? [[key, summaries.get(key)!] as const] : [])))
  }

  function ensureInspection(path: string): Promise<FolderInspection | null> {
    const key = normalizeFolderPath(path)
    const known = inspections.get(key)
    if (known) return Promise.resolve(known)
    const pending = pendingInspections.get(key)
    if (pending) return pending
    const request = (async () => {
      if (inspecting >= INSPECTION_CONCURRENCY) await new Promise<void>((resolve) => inspectionQueue.push(resolve))
      inspecting += 1
      try {
        if (disposed) return null
        const response = await api(`/api/v1/path/inspect?path=${encodeURIComponent(key)}`)
        if (!response.ok) {
          failedInspections.add(key)
          return null
        }
        const inspection: FolderInspection = await response.json()
        failedInspections.delete(key)
        inspections.set(key, inspection)
        if (!summaries.has(key)) summaries.set(key, inspection)
        return inspection
      } catch {
        failedInspections.add(key)
        return null
      } finally {
        pendingInspections.delete(key)
        inspecting -= 1
        inspectionQueue.shift()?.()
      }
    })()
    pendingInspections.set(key, request)
    return request
  }

  async function loadUnclaimed() {
    try {
      const response = await api('/api/v1/path/unclaimed')
      if (response.ok) unclaimed.value = await response.json()
    } catch {
      unclaimed.value = null
    }
  }

  async function searchFolders(query: string, signal?: AbortSignal, includeSystem = false): Promise<FolderSearchResult | null> {
    try {
      const response = await api(`/api/v1/path/search?q=${encodeURIComponent(query)}${includeSystem ? '&system=true' : ''}`, { signal })
      return response.ok ? await response.json() : null
    } catch {
      return null
    }
  }

  async function createFolder(parent: string, name: string): Promise<{ path: string } | { error: CreateFolderError }> {
    try {
      const response = await api('/api/v1/path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentPath: normalizeFolderPath(parent), name }),
      })
      if (!response.ok) {
        const error: CreateFolderError =
          response.status === 409 ? 'exists' : response.status === 403 ? 'denied' : response.status === 400 ? 'invalid' : 'failed'
        return { error }
      }
      const created: CreateFolderResult = await response.json()
      // A new folder changes what the folders above it hold, so their counts are asked for again.
      const parentKey = normalizeFolderPath(parent)
      const stale = [...summaries.keys()].filter((key) => isAtOrInside(parentKey, key))
      for (const key of stale) {
        summaries.delete(key)
        requestedSummaries.delete(key)
      }
      for (const key of inspections.keys()) if (isAtOrInside(parentKey, key)) inspections.delete(key)
      listings.delete(parentKey)
      void ensureListing(parentKey)
      requestSummaries(stale)
      return { path: normalizeFolderPath(created.path) }
    } catch {
      return { error: 'failed' }
    }
  }

  function dispose() {
    disposed = true
    if (summaryTimer) clearTimeout(summaryTimer)
    summaryTimer = null
    for (const release of inspectionQueue.splice(0)) release()
  }

  return {
    places,
    placesFailed,
    unclaimed,
    listings,
    summaries,
    inspections,
    failedInspections,
    loadPlaces,
    ensureListing,
    requestSummaries,
    summariesFor,
    ensureInspection,
    loadUnclaimed,
    searchFolders,
    createFolder,
    dispose,
  }
}

export type FolderPickerData = ReturnType<typeof useFolderPickerData>
