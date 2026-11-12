import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AiJobActionResponse, AiJobList, AiJobListItem, AiJobListScope, AiJobListView, AiJobQueueAction } from '@bookorbit/types'

import { actOnAiJobs, listAiJobs } from '../api/ai-jobs.api'
import { listenToAiJobs } from '../lib/ai-jobs-socket'

export const AI_JOB_PAGE_SIZE = 50
/** Socket pushes are read at most this often, so a running build does not reread the list every second. */
export const AI_JOBS_REFRESH_GAP_MS = 2_000
/** While the socket is down, the list is read this often instead. */
export const AI_JOBS_POLL_MS = 15_000

/**
 * One page of the AI area's job list: a view, whose jobs (the viewer's or everyone's), the
 * selection, and acting on it. Read again when the `/ai-jobs` socket says something changed, at
 * most every two seconds, and polled while the socket is down. Changes heard while the page is
 * hidden are read when it is visible again. Answers older than one already shown are dropped.
 */
export function useAiJobList() {
  const view = ref<AiJobListView>('queue')
  const scope = ref<AiJobListScope>('mine')
  const offset = ref(0)
  const list = ref<AiJobList | null>(null)
  const loading = ref(true)
  const failed = ref(false)
  const selectedIds = ref<ReadonlySet<string>>(new Set())
  const acting = ref<AiJobQueueAction | null>(null)

  const items = computed<AiJobListItem[]>(() => list.value?.items ?? [])
  const total = computed(() => list.value?.total ?? 0)
  const selected = computed(() => items.value.filter((item) => selectedIds.value.has(item.id)))
  /** Actions at least one selected job allows, in the order the server lists them. */
  const selectedActions = computed<AiJobQueueAction[]>(() => {
    const allowed = new Set(selected.value.flatMap((item) => item.actions))
    return (['resume', 'retry', 'pause', 'prioritize', 'dismiss', 'cancel'] as const).filter((action) => allowed.has(action))
  })
  const allSelected = computed(() => items.value.length > 0 && items.value.every((item) => selectedIds.value.has(item.id)))

  let generation = 0
  let mounted = false
  let live = false
  let stale = false
  let lastLoadAt = 0
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let stopListening: (() => void) | null = null

  async function load(): Promise<void> {
    const current = ++generation
    lastLoadAt = Date.now()
    failed.value = false
    try {
      const next = await listAiJobs({ view: view.value, scope: scope.value, offset: offset.value, limit: AI_JOB_PAGE_SIZE })
      if (current !== generation) return
      list.value = next
      // A job that left the page cannot stay selected.
      const shown = new Set(next.items.map((item) => item.id))
      if ([...selectedIds.value].some((id) => !shown.has(id))) selectedIds.value = new Set([...selectedIds.value].filter((id) => shown.has(id)))
      // A page emptied by an action steps back, so the list never strands on an empty page.
      if (next.items.length === 0 && offset.value > 0 && next.total > 0) offset.value = Math.max(0, offset.value - AI_JOB_PAGE_SIZE)
    } catch {
      if (current === generation) failed.value = true
    } finally {
      if (current === generation) loading.value = false
    }
  }

  function scheduleRefresh(): void {
    if (!mounted) return
    if (document.visibilityState === 'hidden') {
      stale = true
      return
    }
    if (refreshTimer) return
    const wait = Math.max(0, AI_JOBS_REFRESH_GAP_MS - (Date.now() - lastLoadAt))
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void load()
    }, wait)
  }

  function setLive(next: boolean): void {
    live = next
    if (pollTimer) clearInterval(pollTimer)
    pollTimer = null
    if (!live && mounted) pollTimer = setInterval(scheduleRefresh, AI_JOBS_POLL_MS)
    // Changes made while the socket was down were never pushed.
    else if (live) scheduleRefresh()
  }

  function handleVisibility(): void {
    if (document.visibilityState !== 'visible' || !stale) return
    stale = false
    scheduleRefresh()
  }

  function startOver(): void {
    selectedIds.value = new Set()
    loading.value = true
    if (offset.value !== 0) offset.value = 0
    else void load()
  }

  watch([view, scope], startOver)
  watch(offset, () => {
    selectedIds.value = new Set()
    void load()
  })

  onMounted(() => {
    mounted = true
    void load()
    stopListening = listenToAiJobs({ changed: scheduleRefresh, live: setLive })
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

  /** Acts on the given jobs that allow it, then reads the list again. Null when none allow it or the request failed. */
  async function act(action: AiJobQueueAction, targets: readonly AiJobListItem[]): Promise<AiJobActionResponse | null> {
    const ids = targets.filter((item) => item.actions.includes(action)).map((item) => item.id)
    if (ids.length === 0 || acting.value) return null
    acting.value = action
    try {
      const response = await actOnAiJobs({ action, ids })
      const done = new Set(response.results.filter((result) => result.outcome === 'done').map((result) => result.id))
      selectedIds.value = new Set([...selectedIds.value].filter((id) => !done.has(id)))
      return response
    } finally {
      acting.value = null
      await load()
    }
  }

  return {
    view,
    scope,
    offset,
    list,
    items,
    total,
    loading,
    failed,
    acting,
    selectedIds,
    selected,
    selectedActions,
    allSelected,
    load,
    toggle,
    toggleAll,
    clearSelection,
    act,
  }
}
