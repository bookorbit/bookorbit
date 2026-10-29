import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import type { ReadAloudJobEvent, ReadAloudJobEventsResponse } from '@bookorbit/types'
import { api } from '@/lib/api'

/** A socket can push a job update every second; the log does not need to follow that closely. */
export const READ_ALOUD_EVENTS_MIN_INTERVAL_MS = 5_000

/**
 * The activity log of one job, read only while it is open. The first read takes everything, later
 * ones ask only for events newer than the last one held, whenever the job itself changes.
 */
export function useReadAloudEvents(jobId: Ref<string>, open: Ref<boolean>, version: Ref<string>) {
  const events = shallowRef<ReadAloudJobEvent[]>([])
  const loaded = ref(false)
  const failed = ref(false)
  const fetching = ref(false)
  const loading = computed(() => fetching.value && !loaded.value)

  let generation = 0
  let lastId = 0
  let lastFetchAt = 0
  let queued = false
  let throttleTimer: ReturnType<typeof setTimeout> | null = null

  function clearThrottle(): void {
    if (throttleTimer !== null) clearTimeout(throttleTimer)
    throttleTimer = null
  }

  async function fetchEvents(): Promise<void> {
    if (fetching.value) {
      queued = true
      return
    }
    const gen = generation
    fetching.value = true
    try {
      const query = lastId > 0 ? `?after=${lastId}` : ''
      const response = await api(`/api/v1/read-aloud-jobs/${encodeURIComponent(jobId.value)}/events${query}`)
      if (gen !== generation) return
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = (await response.json()) as ReadAloudJobEventsResponse
      if (gen !== generation) return
      const fresh = body.events.filter((event) => event.id > lastId)
      if (fresh.length > 0) {
        events.value = [...events.value, ...fresh]
        lastId = Math.max(...fresh.map((event) => event.id))
      }
      loaded.value = true
      failed.value = false
    } catch {
      if (gen === generation) failed.value = true
    } finally {
      if (gen === generation) {
        fetching.value = false
        lastFetchAt = Date.now()
        if (queued) {
          queued = false
          schedule()
        }
      }
    }
  }

  function schedule(): void {
    if (!open.value || throttleTimer !== null) return
    const wait = lastFetchAt + READ_ALOUD_EVENTS_MIN_INTERVAL_MS - Date.now()
    if (wait <= 0) {
      void fetchEvents()
      return
    }
    throttleTimer = setTimeout(() => {
      throttleTimer = null
      if (open.value) void fetchEvents()
    }, wait)
  }

  function reset(): void {
    generation += 1
    clearThrottle()
    events.value = []
    loaded.value = false
    failed.value = false
    fetching.value = false
    queued = false
    lastId = 0
    lastFetchAt = 0
  }

  watch(jobId, () => {
    reset()
    if (open.value) void fetchEvents()
  })

  watch(
    open,
    (isOpen) => {
      if (isOpen) void fetchEvents()
      else clearThrottle()
    },
    { immediate: true },
  )

  watch(version, () => {
    if (open.value) schedule()
  })

  onScopeDispose(() => {
    generation += 1
    clearThrottle()
  })

  return { events, loading, failed, reload: fetchEvents }
}
