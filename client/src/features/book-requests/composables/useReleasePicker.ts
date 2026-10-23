import { ref, shallowReactive } from 'vue'
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
 * A request's last search, kept for a moment on this side too. The picker for a pair searches both
 * halves when it opens, and the server never merges a search still in flight, so the half the
 * approver switches to reads its answer here instead of asking every tracker a second time. Every
 * search that answers replaces the entry, so switching back shows the list that was last on screen.
 */
interface DefaultSearch {
  startedAt: number
  result: ReleaseSearchResult | null
  pending: Promise<ReleaseSearchResult | null> | null
}

/** The server's own cache window; past it, a revisit searches again. */
const SEARCH_CACHE_TTL_MS = 3 * 60 * 1000
const SEARCH_CACHE_LIMIT = 8
/** Reactive so a tab can show the other half's count the moment its search lands. */
const defaultSearches = shallowReactive(new Map<string, DefaultSearch>())

function defaultSearchPath(canManage: boolean, requestId: number): string {
  return `${fulfilmentBase(canManage)}/${requestId}/releases`
}

function freshEntry(path: string): DefaultSearch | null {
  const entry = defaultSearches.get(path)
  return entry && Date.now() - entry.startedAt <= SEARCH_CACHE_TTL_MS ? entry : null
}

function rememberSearch(path: string, entry: DefaultSearch): void {
  defaultSearches.delete(path)
  defaultSearches.set(path, entry)
  if (defaultSearches.size > SEARCH_CACHE_LIMIT) defaultSearches.delete(defaultSearches.keys().next().value!)
}

/** One default search, shared by everything that asks for it while it runs. */
function loadDefaultSearch(path: string, refresh: boolean): Promise<ReleaseSearchResult | null> {
  const existing = refresh ? null : freshEntry(path)
  if (existing?.result) return Promise.resolve(existing.result)
  if (existing?.pending) return existing.pending

  const startedAt = Date.now()
  const pending = (async () => {
    try {
      const res = await api(refresh ? `${path}?refresh=true` : path)
      if (!res.ok) return null
      return (await res.json()) as ReleaseSearchResult
    } catch {
      return null
    }
  })()
  rememberSearch(path, { startedAt, result: null, pending })
  void pending.then((result) => {
    // Only the search that still owns the slot may settle it: a refresh started meanwhile replaced it.
    if (defaultSearches.get(path)?.pending !== pending) return
    if (result) rememberSearch(path, { startedAt, result, pending: null })
    else defaultSearches.delete(path)
  })
  return pending
}

/** Starts a request's default search ahead of time, so opening it shows the list straight away. */
export function prefetchReleaseSearch(canManage: boolean, requestId: number): void {
  void loadDefaultSearch(defaultSearchPath(canManage, requestId), false)
}

/** What is known about a request's default search without asking for it. */
export function peekReleaseSearch(canManage: boolean, requestId: number): { searching: boolean; count: number | null } {
  const entry = freshEntry(defaultSearchPath(canManage, requestId))
  return { searching: entry?.pending != null, count: entry?.result?.releases.length ?? null }
}

/** For tests: every module-level answer is forgotten. */
export function clearReleaseSearchCache(): void {
  defaultSearches.clear()
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

  function applyResult(result: ReleaseSearchResult): void {
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
  }

  async function fetchReleases(requestId: number, options: { refresh?: boolean; overrides?: ReleaseSearchOverrides } = {}): Promise<boolean> {
    const generation = ++searchGeneration
    const custom = options.overrides !== undefined
    const path = defaultSearchPath(canManage(), requestId)
    loadFailed.value = false
    clearInspections()
    // A search already answered is shown in the same tick, so switching to it never flashes a spinner.
    const known = custom || options.refresh ? null : freshEntry(path)?.result
    if (known) {
      // It is a list already searched, which is what the cached note says.
      applyResult({ ...known, cached: true })
      loading.value = false
      return true
    }

    loading.value = true
    try {
      let result: ReleaseSearchResult | null
      if (custom) {
        const res = await api(`${path}/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options.overrides),
        })
        result = res.ok ? ((await res.json()) as ReleaseSearchResult) : null
        if (result) rememberSearch(path, { startedAt: Date.now(), result, pending: null })
      } else {
        result = await loadDefaultSearch(path, options.refresh === true)
      }
      if (generation !== searchGeneration) return false
      if (!result) {
        loadFailed.value = true
        return false
      }
      applyResult(result)
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
