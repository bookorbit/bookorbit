import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import type { Socket } from 'socket.io-client'
import {
  READ_ALOUD_JOB_UPDATED_EVENT,
  READ_ALOUD_SOCKET_NAMESPACE,
  type CreateReadAloudJobRequest,
  type ReadAloudCapability,
  type ReadAloudDecisions,
  type ReadAloudJob,
} from '@bookorbit/types'
import { api } from '@/lib/api'
import { createAuthenticatedSocket } from '@/lib/socket'
import { isActiveJob, isCompletedJob } from '../lib/read-aloud'

/**
 * Jobs run for hours, so the poll only has to notice a job someone else is running, or a socket
 * that went quiet. The requester gets every change pushed and keeps this as a fallback.
 */
export const READ_ALOUD_POLL_INTERVAL_MS = 30_000

export type ReadAloudAction = 'create' | 'cancel' | 'publish' | 'retry' | 'resync' | 'dismiss'

export type ReadAloudCreateResult = { ok: true } | { ok: false; errorKey: string }

export type UseReadAloudOptions = {
  bookId: Ref<number>
  /** Permission-backed: nothing is fetched or connected while this is false. */
  enabled: Ref<boolean>
  /** The book's current file ids; a change means availability may have changed too. */
  fileIds: Ref<readonly number[]>
  /** The signed-in user. The server pushes a job's updates only to its requester, so only they get a socket. */
  viewerId: Ref<number | null>
  /** Called once when a job finishes publishing while the page watches it, never for a job that loaded finished. */
  onJobCompleted?: (job: ReadAloudJob) => void
}

const ERRORS = 'book.detail.files.readAloud.errors'

class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`)
  }
}

function statusOf(error: unknown): number | null {
  return error instanceof HttpStatusError ? error.status : null
}

function mutationErrorKey(action: Exclude<ReadAloudAction, 'create'>, error: unknown): string {
  const status = statusOf(error)
  if (status === 403) return `${ERRORS}.forbidden`
  if (status === 404) return `${ERRORS}.gone`
  if (status === 409) return `${ERRORS}.conflict`
  return `${ERRORS}.${action}`
}

function createErrorKey(error: unknown): string {
  const status = statusOf(error)
  if (status === 400) return `${ERRORS}.createInvalid`
  if (status === 403) return `${ERRORS}.forbidden`
  if (status === 409) return `${ERRORS}.createConflict`
  if (status === 503) return `${ERRORS}.createUnavailable`
  return `${ERRORS}.create`
}

function timeOf(value: string): number {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function documentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

export function useReadAloud(options: UseReadAloudOptions) {
  const { bookId, enabled, fileIds, viewerId } = options

  const capability = shallowRef<ReadAloudCapability | null>(null)
  const job = shallowRef<ReadAloudJob | null>(null)
  const checking = ref(false)
  const loadFailed = ref(false)
  /** Availability checks that failed in a row with nothing to show, so a repeat failure can say so. */
  const failedChecks = ref(0)
  const action = ref<ReadAloudAction | null>(null)
  /** The last failed job action, shown on the card only; the dialog keeps its own. */
  const jobErrorKey = ref<string | null>(null)

  /** True only before this book's first answer, so a silent recheck never flashes a skeleton. */
  const loading = computed(() => checking.value && capability.value === null)

  let generation = 0
  let disposed = false
  let capabilityController: AbortController | null = null
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  /** A job whose status route answered 403 or 404; polling it again cannot succeed. */
  let pollStoppedForJobId: string | null = null
  let socket: Socket | null = null
  let socketConnectedBefore = false
  /**
   * Bumped by every live job update. A capability answer that started before one carries an older
   * view of the job, so it may refresh the capability but must not roll the job back.
   */
  let jobUpdateSeq = 0
  /** Jobs already known to be finished, so the completion callback fires once per job. */
  const completedJobIds = new Set<string>()

  function canRun(): boolean {
    return !disposed && enabled.value && Number.isSafeInteger(bookId.value) && bookId.value > 0
  }

  function clearPoll(): void {
    if (pollTimer !== null) clearTimeout(pollTimer)
    pollTimer = null
  }

  function closeSocket(): void {
    if (!socket) return
    socket.off(READ_ALOUD_JOB_UPDATED_EVENT, handleSocketJob)
    socket.off('connect', handleSocketConnect)
    socket.disconnect()
    socket = null
  }

  function openSocket(): void {
    socketConnectedBefore = false
    const connection = createAuthenticatedSocket(READ_ALOUD_SOCKET_NAMESPACE, {
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
    })
    connection.on(READ_ALOUD_JOB_UPDATED_EVENT, handleSocketJob)
    connection.on('connect', handleSocketConnect)
    socket = connection
  }

  /** Live updates run only while a job can still change: a socket for its requester, a slow poll for everyone. */
  function syncLiveUpdates(): void {
    const current = job.value
    const live = canRun() && isActiveJob(current)
    const pushed = live && current.requestedBy.id !== null && current.requestedBy.id === viewerId.value
    if (pushed && !socket) openSocket()
    else if (!pushed) closeSocket()

    clearPoll()
    if (!live || !current || pollStoppedForJobId === current.id || documentHidden()) return
    pollTimer = setTimeout(handlePollTick, READ_ALOUD_POLL_INTERVAL_MS)
  }

  async function handlePollTick(): Promise<void> {
    pollTimer = null
    await refreshJob()
    if (pollTimer === null) syncLiveUpdates()
  }

  function applyJob(next: ReadAloudJob | null, source: 'snapshot' | 'update'): void {
    if (next && next.bookId !== bookId.value) return
    const previous = job.value
    if (next && previous) {
      if (next.id === previous.id) {
        // Socket pushes and poll answers can cross; an older copy never overwrites a newer one.
        if (timeOf(next.updatedAt) < timeOf(previous.updatedAt)) return
      } else if (source === 'update' && isActiveJob(previous) && timeOf(next.createdAt) < timeOf(previous.createdAt)) {
        return
      }
    }

    if (source === 'update') jobUpdateSeq += 1
    if (next?.id !== previous?.id) jobErrorKey.value = null
    job.value = next

    if (isCompletedJob(next) && !completedJobIds.has(next.id)) {
      completedJobIds.add(next.id)
      const watchedItFinish = previous?.id === next.id ? !isCompletedJob(previous) : source === 'update'
      if (watchedItFinish) options.onJobCompleted?.(next)
    }

    // A job that just stopped frees the book's slot and may have added a file, so availability moved.
    if (source === 'update' && isActiveJob(previous) && !isActiveJob(next)) void loadCapability()

    syncLiveUpdates()
  }

  async function loadCapability(): Promise<void> {
    if (!canRun()) return
    const current = generation
    capabilityController?.abort()
    const controller = new AbortController()
    capabilityController = controller
    checking.value = true
    const seqAtStart = jobUpdateSeq
    try {
      const response = await api(`/api/v1/books/${bookId.value}/read-aloud`, { signal: controller.signal })
      if (current !== generation || controller.signal.aborted) return
      if (!response.ok) throw new HttpStatusError(response.status)
      const result = (await response.json()) as ReadAloudCapability
      if (current !== generation || controller.signal.aborted) return
      capability.value = result
      loadFailed.value = false
      failedChecks.value = 0
      if (seqAtStart === jobUpdateSeq) applyJob(result.latestJob, 'snapshot')
    } catch {
      if (current !== generation || controller.signal.aborted) return
      // A failed silent recheck keeps the last good answer; only a page with nothing to show reports it.
      if (capability.value === null) {
        loadFailed.value = true
        failedChecks.value += 1
      }
    } finally {
      if (capabilityController === controller) {
        capabilityController = null
        checking.value = false
      }
    }
  }

  async function refreshJob(): Promise<void> {
    const current = job.value
    if (!current || !canRun()) return
    const gen = generation
    try {
      const response = await api(`/api/v1/read-aloud-jobs/${encodeURIComponent(current.id)}`)
      if (gen !== generation) return
      if (response.status === 403 || response.status === 404) {
        pollStoppedForJobId = current.id
        clearPoll()
        if (response.status === 404) void loadCapability()
        return
      }
      if (!response.ok) return
      applyJob((await response.json()) as ReadAloudJob, 'update')
    } catch {
      // The next poll or socket event catches up; a transient failure is not worth a message.
    }
  }

  function handleSocketJob(payload: ReadAloudJob): void {
    if (!payload || typeof payload !== 'object' || payload.bookId !== bookId.value) return
    applyJob(payload, 'update')
  }

  /** The server replays nothing, so a reconnect catches up with one read instead of waiting for the poll. */
  function handleSocketConnect(): void {
    if (socketConnectedBefore) void refreshJob()
    socketConnectedBefore = true
  }

  function handleVisibilityChange(): void {
    if (documentHidden()) {
      clearPoll()
      return
    }
    const current = job.value
    if (!canRun() || !isActiveJob(current) || pollStoppedForJobId === current.id) return
    void refreshJob().then(() => {
      if (pollTimer === null) syncLiveUpdates()
    })
  }

  async function mutate(name: Exclude<ReadAloudAction, 'create'>, path: string, init: RequestInit): Promise<boolean> {
    const current = job.value
    if (!current || action.value !== null || !canRun()) return false
    const gen = generation
    action.value = name
    jobErrorKey.value = null
    try {
      const response = await api(`/api/v1/read-aloud-jobs/${encodeURIComponent(current.id)}${path}`, init)
      if (gen !== generation) return false
      if (!response.ok) throw new HttpStatusError(response.status)
      applyJob((await response.json()) as ReadAloudJob, 'update')
      return true
    } catch (error) {
      if (gen !== generation) return false
      jobErrorKey.value = mutationErrorKey(name, error)
      // The job may have moved on server-side (failed, published, cancelled); show where it is now.
      await refreshJob()
      return false
    } finally {
      if (gen === generation) action.value = null
    }
  }

  async function create(input: CreateReadAloudJobRequest): Promise<ReadAloudCreateResult> {
    if (action.value !== null || !canRun()) return { ok: false, errorKey: `${ERRORS}.create` }
    const gen = generation
    action.value = 'create'
    try {
      const response = await api(`/api/v1/books/${bookId.value}/read-aloud-jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (gen !== generation) return { ok: false, errorKey: `${ERRORS}.create` }
      if (!response.ok) throw new HttpStatusError(response.status)
      applyJob((await response.json()) as ReadAloudJob, 'update')
      return { ok: true }
    } catch (error) {
      // A rejected selection, a job someone else started or an offline worker all mean the
      // capability this dialog was built from is stale.
      if (gen === generation && statusOf(error) !== 403) void loadCapability()
      return { ok: false, errorKey: createErrorKey(error) }
    } finally {
      if (gen === generation) action.value = null
    }
  }

  function cancel(): Promise<boolean> {
    return mutate('cancel', '', { method: 'DELETE' })
  }

  function publish(): Promise<boolean> {
    return mutate('publish', '/publish', { method: 'POST' })
  }

  function retry(): Promise<boolean> {
    return mutate('retry', '/retry', { method: 'POST' })
  }

  function dismiss(): Promise<boolean> {
    return mutate('dismiss', '/dismiss', { method: 'POST' })
  }

  function resync(decisions: ReadAloudDecisions): Promise<boolean> {
    return mutate('resync', '/resync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisions }),
    })
  }

  function reload(): Promise<void> {
    return loadCapability()
  }

  function clearJobError(): void {
    jobErrorKey.value = null
  }

  function reset(): void {
    generation += 1
    capabilityController?.abort()
    capabilityController = null
    checking.value = false
    clearPoll()
    closeSocket()
    capability.value = null
    job.value = null
    loadFailed.value = false
    failedChecks.value = 0
    action.value = null
    jobErrorKey.value = null
    pollStoppedForJobId = null
    completedJobIds.clear()
  }

  watch(
    [bookId, enabled],
    () => {
      reset()
      void loadCapability()
    },
    { immediate: true },
  )

  // Uploading the missing EPUB, deleting a track or a read-along: availability and the dialog's
  // file lists follow the book rather than the moment the tab opened.
  watch(
    () => [bookId.value, fileIds.value.join(',')] as const,
    (next, previous) => {
      if (!previous || next[0] !== previous[0] || next[1] === previous[1]) return
      void loadCapability()
    },
  )

  // The account can load after the tab does; the socket follows whoever is signed in.
  watch(viewerId, () => syncLiveUpdates())

  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', handleVisibilityChange)

  onScopeDispose(() => {
    disposed = true
    generation += 1
    capabilityController?.abort()
    capabilityController = null
    clearPoll()
    closeSocket()
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', handleVisibilityChange)
  })

  return {
    capability,
    job,
    loading,
    loadFailed,
    failedChecks,
    action,
    jobErrorKey,
    reload,
    refreshJob,
    create,
    cancel,
    publish,
    retry,
    resync,
    dismiss,
    clearJobError,
  }
}
