import { computed, onScopeDispose, ref } from 'vue'
import type {
  BookDuplicateGroupOutcome,
  BookDuplicateResolutionEvent,
  BookDuplicateResolutionJob,
  BookDuplicateResolutionRequest,
} from '@bookorbit/types'

import { getSocket } from '@/features/scanner/composables/useScanProgress'
import { errorMessage } from '@/lib/api-json'
import { getBookDuplicateResolution, startBookDuplicateResolution } from '../api/book-duplicates'

/** Without a socket event for this long, the run is read over HTTP instead. */
export const RESOLUTION_POLL_MS = 4000

/**
 * Follows one bulk resolution: per-group progress arrives over the socket, and an HTTP read
 * covers a dropped connection and fills in the full outcome list once the run ends.
 */
export function useDuplicateResolution(onFinished: (job: BookDuplicateResolutionJob) => void) {
  const job = ref<BookDuplicateResolutionJob | null>(null)
  const starting = ref(false)
  const error = ref<string | null>(null)
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let listening = false

  const running = computed(() => starting.value || job.value?.status === 'running')
  const finished = computed(() => job.value !== null && job.value.status !== 'running')

  function stopPolling(): void {
    if (pollTimer !== null) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
  }

  function schedulePoll(): void {
    stopPolling()
    pollTimer = setTimeout(poll, RESOLUTION_POLL_MS)
  }

  async function poll(): Promise<void> {
    const current = job.value
    if (!current || current.status !== 'running') return
    try {
      apply(await getBookDuplicateResolution(current.id))
    } catch {
      schedulePoll()
    }
  }

  function apply(next: BookDuplicateResolutionJob): void {
    if (!job.value || job.value.id !== next.id) return
    job.value = next
    if (next.status === 'running') {
      schedulePoll()
      return
    }
    stopPolling()
    onFinished(next)
  }

  function mergeOutcome(outcomes: BookDuplicateGroupOutcome[], outcome: BookDuplicateGroupOutcome): BookDuplicateGroupOutcome[] {
    const index = outcomes.findIndex((entry) => entry.groupId === outcome.groupId)
    if (index === -1) return [...outcomes, outcome]
    return outcomes.map((entry, position) => (position === index ? outcome : entry))
  }

  function handleProgress(event: BookDuplicateResolutionEvent): void {
    const current = job.value
    if (!current || current.id !== event.jobId) return
    job.value = {
      ...current,
      processed: event.processed,
      total: event.total,
      currentGroupId: event.currentGroupId,
      outcomes: event.outcome ? mergeOutcome(current.outcomes, event.outcome) : current.outcomes,
    }
    schedulePoll()
  }

  function handleFinished(event: BookDuplicateResolutionEvent): void {
    const current = job.value
    if (!current || current.id !== event.jobId) return
    stopPolling()
    void getBookDuplicateResolution(event.jobId)
      .then(apply)
      .catch(() => apply({ ...current, status: event.status, processed: event.processed, currentGroupId: null }))
  }

  function listen(): void {
    if (listening) return
    listening = true
    const socket = getSocket()
    socket.on('book-duplicates:resolution-progress', handleProgress)
    socket.on('book-duplicates:resolution-finished', handleFinished)
  }

  function unlisten(): void {
    if (!listening) return
    listening = false
    const socket = getSocket()
    socket.off('book-duplicates:resolution-progress', handleProgress)
    socket.off('book-duplicates:resolution-finished', handleFinished)
  }

  async function start(request: BookDuplicateResolutionRequest): Promise<boolean> {
    if (running.value) return false
    starting.value = true
    error.value = null
    listen()
    try {
      const started = await startBookDuplicateResolution(request)
      job.value = {
        id: started.jobId,
        scanId: request.scanId,
        status: 'running',
        processed: 0,
        total: started.total,
        currentGroupId: null,
        outcomes: [],
        errorCode: null,
        createdAt: new Date().toISOString(),
        finishedAt: null,
      }
      schedulePoll()
      return true
    } catch (reason) {
      error.value = errorMessage(reason, 'tools.bookDuplicates.errors.resolve')
      return false
    } finally {
      starting.value = false
    }
  }

  function reset(): void {
    if (job.value?.status === 'running') return
    stopPolling()
    job.value = null
    error.value = null
  }

  onScopeDispose(() => {
    stopPolling()
    unlisten()
  })

  return { job, starting, running, finished, error, start, reset }
}
