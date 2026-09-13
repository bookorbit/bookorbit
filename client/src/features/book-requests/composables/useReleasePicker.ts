import { ref } from 'vue'
import { api } from '@/lib/api'
import { fulfilmentBase } from '../fulfilmentBase'
import type {
  IndexerSearchStatus,
  InspectBookRequestReleasePayload,
  ReleaseCandidateItem,
  ReleaseFileInspection,
  ReleaseSearchCriteria,
  ReleaseSearchOverrides,
  ReleaseSearchResult,
} from '@bookorbit/types'

/** A title and author search has no ISBN to key an attempt by, so it gets a reserved name. */
export const TITLE_AUTHOR_SEARCH_KEY = 'titleAuthor'

/** The key one search ran under, which is the ISBN it used or the title and author fallback. */
export function searchAttemptKey(activeIsbn: string | null): string {
  return activeIsbn ?? TITLE_AUTHOR_SEARCH_KEY
}

/**
 * The ranked cross-indexer release list for one request. The server does the searching, scoring
 * and caching; this only asks, and asks again with `refresh` when the approver wants a fresh hit
 * on the trackers rather than the cached list.
 */
export function useReleasePicker(canManage: () => boolean) {
  const basePath = () => fulfilmentBase(canManage())
  const releases = ref<ReleaseCandidateItem[]>([])
  const indexers = ref<IndexerSearchStatus[]>([])
  const criteria = ref<ReleaseSearchCriteria | null>(null)
  /** Enabled indexers that do not carry this medium and were never searched. Not failures. */
  const uncoveredIndexerCount = ref(0)
  /**
   * What the instance had to search with. Zero enabled means nothing was searched at all, which
   * the picker cannot work out any other way: the indexer list is admin-only, and an approver who
   * cannot open settings is exactly who ends up staring at an empty list.
   */
  const enabledIndexerCount = ref(0)
  const configuredIndexerCount = ref(0)
  const profileActive = ref(false)
  const cached = ref(false)
  const loading = ref(false)
  const loadFailed = ref(false)
  const searched = ref(false)
  /**
   * What this visit has already searched, keyed by `searchAttemptKey` and valued by how many
   * releases came back. Every alternate ISBN on a request usually carries the same provider label,
   * so without this the keys the approver has already spent are indistinguishable from the ones
   * they have not. Local to the picker and dropped on reset; nothing about it is worth persisting.
   */
  const attempts = ref(new Map<string, number>())
  const inspections = ref(new Map<string, ReleaseFileInspection>())
  const inspecting = ref(new Set<string>())
  /**
   * Keyed by release, valued by what the tracker said. A refusal is usually a sentence worth
   * repeating verbatim - "VIP torrent and you are not VIP or higher" tells an approver exactly
   * what to do next, where "could not read the file list" tells them nothing.
   */
  const inspectionFailed = ref(new Map<string, string | null>())
  const pendingInspections = new Map<string, Promise<ReleaseFileInspection | null>>()
  let inspectionGeneration = 0
  /**
   * Bumped per search so an answer to an earlier one cannot land on a later one. A tracker search
   * can take the better part of a minute, which is long enough for the approver to step to another
   * request or to search again with different terms before the first one comes back.
   */
  let searchGeneration = 0

  async function fetchReleases(requestId: number, options: { refresh?: boolean; overrides?: ReleaseSearchOverrides } = {}): Promise<boolean> {
    const generation = ++searchGeneration
    loading.value = true
    loadFailed.value = false
    clearInspections()
    try {
      const custom = options.overrides !== undefined
      const url = `${basePath()}/${requestId}/releases${custom ? '/search' : options.refresh ? '?refresh=true' : ''}`
      const res = custom
        ? await api(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(options.overrides),
          })
        : await api(url)
      if (generation !== searchGeneration) return false
      if (!res.ok) {
        loadFailed.value = true
        return false
      }
      const result = (await res.json()) as ReleaseSearchResult
      if (generation !== searchGeneration) return false
      releases.value = result.releases
      criteria.value = result.criteria
      indexers.value = result.indexers
      uncoveredIndexerCount.value = result.uncoveredIndexerCount
      enabledIndexerCount.value = result.enabledIndexerCount
      configuredIndexerCount.value = result.configuredIndexerCount
      profileActive.value = result.profileActive
      cached.value = result.cached
      searched.value = true
      attempts.value = new Map(attempts.value).set(searchAttemptKey(result.criteria.activeIsbn), result.releases.length)
      return true
    } catch {
      if (generation === searchGeneration) loadFailed.value = true
      return false
    } finally {
      // A newer search owns the spinner from here, so an older one must not put it away.
      if (generation === searchGeneration) loading.value = false
    }
  }

  async function inspectRelease(requestId: number, release: ReleaseCandidateItem): Promise<ReleaseFileInspection | null> {
    const key = releaseKey(release)
    const existing = inspections.value.get(key)
    if (existing) return existing
    const pending = pendingInspections.get(key)
    if (pending) return pending

    const generation = inspectionGeneration
    setMembership(inspecting, key, true)
    clearFailure(inspectionFailed, key)
    const operation = performInspection(requestId, release, key, generation)
    pendingInspections.set(key, operation)
    void operation.finally(() => {
      if (pendingInspections.get(key) !== operation) return
      pendingInspections.delete(key)
      setMembership(inspecting, key, false)
    })
    return operation
  }

  async function performInspection(
    requestId: number,
    release: ReleaseCandidateItem,
    key: string,
    generation: number,
  ): Promise<ReleaseFileInspection | null> {
    try {
      const res = await api(`${basePath()}/${requestId}/releases/inspect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ indexerId: release.indexerId, releaseGuid: release.guid } satisfies InspectBookRequestReleasePayload),
      })
      if (generation !== inspectionGeneration) return null
      if (!res.ok) {
        recordFailure(inspectionFailed, key, await readErrorMessage(res))
        return null
      }
      const result = (await res.json()) as ReleaseFileInspection
      inspections.value = new Map(inspections.value).set(key, result)
      return result
    } catch {
      // A transport failure has no server sentence to pass on, so the generic copy stands.
      if (generation === inspectionGeneration) recordFailure(inspectionFailed, key, null)
      return null
    }
  }

  function reset(): void {
    searchGeneration++
    releases.value = []
    criteria.value = null
    indexers.value = []
    uncoveredIndexerCount.value = 0
    enabledIndexerCount.value = 0
    configuredIndexerCount.value = 0
    profileActive.value = false
    cached.value = false
    loadFailed.value = false
    searched.value = false
    attempts.value = new Map()
    clearInspections()
  }

  function clearInspections(): void {
    inspectionGeneration++
    inspections.value = new Map()
    inspecting.value = new Set()
    inspectionFailed.value = new Map()
    pendingInspections.clear()
  }

  return {
    releases,
    criteria,
    indexers,
    uncoveredIndexerCount,
    enabledIndexerCount,
    configuredIndexerCount,
    profileActive,
    cached,
    loading,
    loadFailed,
    searched,
    attempts,
    inspections,
    inspecting,
    inspectionFailed,
    fetchReleases,
    inspectRelease,
    reset,
  }
}

function releaseKey(release: ReleaseCandidateItem): string {
  return `${release.indexerId}:${release.guid}`
}

function recordFailure(target: { value: Map<string, string | null> }, key: string, reason: string | null): void {
  const next = new Map(target.value)
  next.set(key, reason)
  target.value = next
}

function clearFailure(target: { value: Map<string, string | null> }, key: string): void {
  if (!target.value.has(key)) return
  const next = new Map(target.value)
  next.delete(key)
  target.value = next
}

/** Nest puts the reason in `message`, as a string or as a list of validation failures. */
async function readErrorMessage(res: Response): Promise<string | null> {
  const payload = (await res.json().catch(() => null)) as { message?: string | string[] } | null
  const message = Array.isArray(payload?.message) ? payload.message.join('. ') : payload?.message
  return message?.trim() ? message.trim() : null
}

function setMembership(target: { value: Set<string> }, key: string, present: boolean): void {
  const next = new Set(target.value)
  if (present) next.add(key)
  else next.delete(key)
  target.value = next
}
