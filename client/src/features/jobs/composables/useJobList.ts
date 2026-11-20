import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type {
  JobActionKind,
  JobActionResponse,
  JobCounts,
  JobList,
  JobListItem,
  JobScope,
  JobType,
  JobView,
  JobsChangedEvent,
} from '@bookorbit/types'

import { ApiError } from '@/lib/api-json'
import { actOnJobs, listJobs } from '../api/jobs.api'
import { listenToJobs } from '../lib/jobs-socket'
import { DEFAULT_JOBS_FILTER, type JobsFilter } from '../lib/jobs-filter'
import { JOB_ACTION_ORDER } from '../lib/job-presentation'

export const JOB_PAGE_SIZE = 50
/** Pushes are read at most this often, so a running job does not reread the list every second. */
export const JOBS_REFRESH_GAP_MS = 2_000
/** While the socket is down, the list is read this often instead. */
export const JOBS_POLL_MS = 15_000

/**
 * One page of the Jobs area: a view, a type filter, whose jobs, a stack of cursors for Previous and
 * Next, the selection, and acting on it. Counts are read on navigation and when a job changes
 * status, not on progress. A push about a type outside the filter is ignored; progress only rereads
 * a page that shows a running job of that type. Polled while the socket is down; changes heard
 * while the page is hidden are read when it is visible again. A cursor the server refuses sends the
 * list back to its first page, and answers older than one already shown are dropped. A type or scope
 * the viewer cannot see, such as one from an old link, falls back to all types or their own jobs.
 */
export function useJobList(initial: Partial<JobsFilter> = {}) {
  const view = ref<JobView>(initial.view ?? DEFAULT_JOBS_FILTER.view)
  const scope = ref<JobScope>(initial.scope ?? DEFAULT_JOBS_FILTER.scope)
  const type = ref<JobType | null>(initial.type ?? DEFAULT_JOBS_FILTER.type)
  /** The view and scope that produced the page currently on screen. */
  const displayedView = ref(view.value)
  const displayedScope = ref(scope.value)
  /** The types the viewer can see, for the type filter; empty until the first answer. */
  const types = ref<JobType[]>([])
  /** The scopes the viewer may ask for; null until the first answer. */
  const scopes = ref<JobScope[] | null>(null)
  /** The cursor each page was read from; the last is the current page. */
  const cursors = ref<(string | null)[]>([null])
  const list = ref<JobList | null>(null)
  const counts = ref<JobCounts | null>(null)
  const loading = ref(true)
  const failed = ref(false)
  const selectedIds = ref<ReadonlySet<string>>(new Set())
  const acting = ref<JobActionKind | null>(null)

  const items = computed<JobListItem[]>(() => list.value?.items ?? [])
  const page = computed(() => cursors.value.length - 1)
  const hasPrevious = computed(() => page.value > 0)
  const hasNext = computed(() => Boolean(list.value?.next))
  const selected = computed(() => items.value.filter((item) => selectedIds.value.has(item.id)))
  /** How many selected jobs allow each action. */
  const selectedActionCounts = computed<ReadonlyMap<JobActionKind, number>>(() => {
    const allowed = new Map<JobActionKind, number>()
    for (const action of selected.value.flatMap((item) => item.actions)) allowed.set(action, (allowed.get(action) ?? 0) + 1)
    return allowed
  })
  /** Actions at least one selected job allows. Each is taken only on the jobs that allow it. */
  const selectedActions = computed<JobActionKind[]>(() => JOB_ACTION_ORDER.filter((action) => selectedActionCounts.value.has(action)))
  const allSelected = computed(() => items.value.length > 0 && items.value.every((item) => selectedIds.value.has(item.id)))

  let generation = 0
  let mounted = false
  let live = false
  let stale = false
  let staleCounts = false
  let lastLoadAt = 0
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let refreshCounts = false
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let stopListening: (() => void) | null = null

  async function load(withCounts = false): Promise<void> {
    const current = ++generation
    lastLoadAt = Date.now()
    failed.value = false
    const cursor = cursors.value.at(-1) ?? null
    const requestedView = view.value
    const requestedScope = scope.value
    /** Set when the answer changes the filter, whose watch reads the list again. */
    let refiltered = false
    try {
      const next = await listJobs({ view: view.value, type: type.value, scope: scope.value, cursor, limit: JOB_PAGE_SIZE, counts: withCounts })
      if (current !== generation) return
      if (next.types) types.value = next.types
      if (next.scopes) scopes.value = next.scopes
      if (type.value !== null && next.types && !next.types.includes(type.value)) {
        refiltered = true
        type.value = null
        return
      }
      if (next.scopes && !next.scopes.includes(scope.value)) {
        refiltered = true
        scope.value = 'mine'
        return
      }
      displayedView.value = requestedView
      displayedScope.value = requestedScope
      list.value = next
      if (next.counts) counts.value = next.counts
      // A job that left the page cannot stay selected.
      const shown = new Set(next.items.map((item) => item.id))
      if ([...selectedIds.value].some((id) => !shown.has(id))) selectedIds.value = new Set([...selectedIds.value].filter((id) => shown.has(id)))
      // A page emptied by an action steps back, so the list never strands on an empty page.
      if (next.items.length === 0 && cursors.value.length > 1) {
        cursors.value = cursors.value.slice(0, -1)
        void load()
      }
    } catch (reason) {
      if (current !== generation) return
      // A cursor the server no longer accepts starts the list over rather than failing it.
      if (reason instanceof ApiError && reason.status === 400 && cursor !== null) {
        cursors.value = [null]
        void load(true)
        return
      }
      // Asking for everyone's jobs without the permission to see them shows the viewer's own instead.
      if (reason instanceof ApiError && reason.status === 403 && scope.value === 'everyone') {
        refiltered = true
        scope.value = 'mine'
        return
      }
      failed.value = true
    } finally {
      if (current === generation && !refiltered) loading.value = false
    }
  }

  function scheduleRefresh(withCounts: boolean): void {
    if (!mounted) return
    if (document.visibilityState === 'hidden') {
      stale = true
      staleCounts ||= withCounts
      return
    }
    refreshCounts ||= withCounts
    if (refreshTimer) return
    const wait = Math.max(0, JOBS_REFRESH_GAP_MS - (Date.now() - lastLoadAt))
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      const andCounts = refreshCounts
      refreshCounts = false
      void load(andCounts)
    }, wait)
  }

  function handleChanged(event: JobsChangedEvent): void {
    if (type.value !== null && event.type !== type.value) return
    if (event.state) {
      scheduleRefresh(true)
      return
    }
    if (items.value.some((item) => item.type === event.type && item.status === 'running')) scheduleRefresh(false)
  }

  function poll(): void {
    scheduleRefresh(true)
  }

  function setLive(next: boolean): void {
    live = next
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = null
    if (!live && mounted) pollTimer = setInterval(poll, JOBS_POLL_MS)
    // Changes made while the socket was down were never pushed.
    else if (live) scheduleRefresh(true)
  }

  function handleVisibility(): void {
    if (document.visibilityState !== 'visible' || !stale) return
    stale = false
    const withCounts = staleCounts
    staleCounts = false
    scheduleRefresh(withCounts)
  }

  function startOver(): void {
    selectedIds.value = new Set()
    loading.value = true
    cursors.value = [null]
    void load(true)
  }

  watch([view, scope, type], startOver)

  onMounted(() => {
    mounted = true
    void load(true)
    stopListening = listenToJobs({ changed: handleChanged, live: setLive })
    if (!live) setLive(false)
    document.addEventListener('visibilitychange', handleVisibility)
  })

  onBeforeUnmount(() => {
    mounted = false
    generation++
    stopListening?.()
    stopListening = null
    if (refreshTimer) clearTimeout(refreshTimer)
    if (pollTimer) clearInterval(pollTimer)
    refreshTimer = null
    pollTimer = null
    document.removeEventListener('visibilitychange', handleVisibility)
  })

  function nextPage(): void {
    const next = list.value?.next
    if (!next) return
    selectedIds.value = new Set()
    cursors.value = [...cursors.value, next]
    void load()
  }

  function previousPage(): void {
    if (cursors.value.length <= 1) return
    selectedIds.value = new Set()
    cursors.value = cursors.value.slice(0, -1)
    void load()
  }

  function toggle(id: string): void {
    const next = new Set(selectedIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedIds.value = next
  }

  function toggleAll(): void {
    selectedIds.value = allSelected.value ? new Set() : new Set(items.value.map((item) => item.id))
  }

  function clearSelection(): void {
    selectedIds.value = new Set()
  }

  /** Acts on the given jobs that allow it, then reads the list and counts again. Null when none allow it. */
  async function act(action: JobActionKind, targets: readonly JobListItem[]): Promise<JobActionResponse | null> {
    const ids = targets.filter((item) => item.actions.includes(action)).map((item) => item.id)
    if (ids.length === 0 || acting.value) return null
    acting.value = action
    try {
      const response = await actOnJobs({ action, ids })
      const done = new Set(response.results.filter((result) => result.outcome === 'done').map((result) => result.id))
      selectedIds.value = new Set([...selectedIds.value].filter((id) => !done.has(id)))
      return response
    } finally {
      acting.value = null
      await load(true)
    }
  }

  return {
    view,
    scope,
    type,
    displayedView,
    displayedScope,
    types,
    scopes,
    page,
    list,
    counts,
    items,
    loading,
    failed,
    acting,
    selectedIds,
    selected,
    selectedActions,
    selectedActionCounts,
    allSelected,
    hasPrevious,
    hasNext,
    load,
    nextPage,
    previousPage,
    toggle,
    toggleAll,
    clearSelection,
    act,
  }
}
