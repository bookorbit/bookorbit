import { computed, onScopeDispose, ref, shallowRef } from 'vue'
import type {
  BookMergeField,
  BookMergeJob,
  BookMergeJobEvent,
  BookMergeJobResult,
  BookMergeJobStatus,
  BookMergePreviewRequest,
  BookMergePreviewResponse,
  BookMergeRequest,
  BookMergeSourceOutcome,
} from '@bookorbit/types'
import { ApiError, errorMessage } from '@/lib/api-json'
import { fetchMergeJob, fetchMergePreview, startMerge } from '../api/book-merge'
import {
  MERGE_ACCESS_LOSS_NOT_ACKNOWLEDGED,
  MERGE_BLOCKED,
  MERGE_PREVIEW_STALE,
  accessLossWarning,
  describePreviewChanges,
  mergeDestinationLibraryId,
  isBlankMergeValue,
  isTerminalMergeStatus,
  recommendMergeKeeper,
  type BookMergePreviewChange,
} from '../lib/book-merge'
import { useBookEvents } from './useBookEvents'

/** Keeper and destination changes settle for this long before the preview is asked again. */
export const MERGE_PREVIEW_DEBOUNCE_MS = 350
/** Without a socket event for this long, the job is read over HTTP instead. */
export const MERGE_JOB_POLL_MS = 4000
/** Consecutive failed job reads after which polling gives up; the merge itself carries on server-side. */
export const MERGE_JOB_POLL_MAX_FAILURES = 5

export interface BookMergeJobState {
  jobId: number
  /** The library the merged book lives in afterwards. */
  libraryId: number | null
  /** Every library the books were in before the merge. */
  sourceLibraryIds: number[]
  targetBookId: number
  sourceBookIds: number[]
  status: BookMergeJobStatus
  processed: number
  total: number
  currentSourceBookId: number | null
  outcomes: BookMergeSourceOutcome[]
  result: BookMergeJobResult | null
  errorCode: string | null
  /** Bytes the merge copies or moves in all, when the server counts them (cross-drive copies). */
  bytesTotal: number | null
  bytesDone: number | null
}

export interface StartMergeOptions {
  /** A keeper the caller already knows (the detail page's own book). Otherwise the keeper rule picks one. */
  keeperId?: number | null
}

export function useBookMerge() {
  const bookIds = ref<number[]>([])
  const keeperId = ref<number | null>(null)
  const destinationId = ref<number | null>(null)
  const fieldOverrides = ref<Partial<Record<BookMergeField, number>>>({})
  const includeTagIds = ref<number[]>([])
  const includeGenreIds = ref<number[]>([])
  const deleteIdenticalCopies = ref(false)
  /** The access-loss warning the reviewer acknowledged, as it read then; a changed one needs a new tick. */
  const acknowledgedAccessLoss = ref<string | null>(null)

  const preview = shallowRef<BookMergePreviewResponse | null>(null)
  const previewLoading = ref(false)
  const previewError = ref<string | null>(null)
  const staleChanges = ref<BookMergePreviewChange[] | null>(null)

  const inFlight = ref(false)
  const executeError = ref<string | null>(null)
  const job = ref<BookMergeJobState | null>(null)
  const jobUnreachable = ref(false)

  // Set once the keeper is settled, by the caller or by the rule, so a later preview never overrides it.
  let keeperSettled = false
  let previewTimer: ReturnType<typeof setTimeout> | null = null
  let previewController: AbortController | null = null
  let previewGeneration = 0
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let pollController: AbortController | null = null
  let pollFailures = 0

  const sourceIds = computed(() => bookIds.value.filter((id) => id !== keeperId.value))
  const jobActive = computed(() => job.value !== null && !isTerminalMergeStatus(job.value.status))
  const jobFinished = computed(() => job.value !== null && isTerminalMergeStatus(job.value.status))
  /** The preview on screen answers the keeper and destination currently chosen. */
  const previewCurrent = computed(() => preview.value !== null && !previewLoading.value && preview.value.targetBookId === keeperId.value)
  const accessLossKey = computed(() => {
    const warning = accessLossWarning(preview.value)
    return warning ? JSON.stringify([preview.value?.destinationBookId ?? null, warning.libraryId ?? null, warning.count ?? null]) : null
  })
  /** Other readers would lose access: the merge needs the reviewer's explicit acknowledgement. */
  const accessLossRequired = computed(() => accessLossKey.value !== null)
  const accessLossAcknowledged = computed(() => accessLossKey.value !== null && acknowledgedAccessLoss.value === accessLossKey.value)
  const canExecute = computed(
    () =>
      previewCurrent.value &&
      preview.value?.eligible === true &&
      preview.value.previewToken !== null &&
      (!accessLossRequired.value || accessLossAcknowledged.value) &&
      !inFlight.value &&
      !jobActive.value,
  )

  const events = useBookEvents()
  events.onBookMergeProgress(applyJobEvent)
  events.onBookMergeFinished(applyJobEvent)

  onScopeDispose(() => {
    cancelPreview()
    stopPolling()
  })

  function cancelPreview(): void {
    if (previewTimer) clearTimeout(previewTimer)
    previewTimer = null
    previewController?.abort()
    previewController = null
  }

  function reset(): void {
    cancelPreview()
    stopPolling()
    previewGeneration += 1
    keeperSettled = false
    bookIds.value = []
    keeperId.value = null
    destinationId.value = null
    fieldOverrides.value = {}
    includeTagIds.value = []
    includeGenreIds.value = []
    deleteIdenticalCopies.value = false
    acknowledgedAccessLoss.value = null
    preview.value = null
    previewLoading.value = false
    previewError.value = null
    staleChanges.value = null
    inFlight.value = false
    executeError.value = null
    job.value = null
    jobUnreachable.value = false
  }

  /** Begins a merge review for these books and loads the first preview straight away. */
  function start(ids: number[], options: StartMergeOptions = {}): Promise<BookMergePreviewResponse | null> {
    reset()
    bookIds.value = [...new Set(ids)]
    const explicit = options.keeperId ?? null
    keeperSettled = explicit !== null && bookIds.value.includes(explicit)
    keeperId.value = keeperSettled ? explicit : (bookIds.value[0] ?? null)
    return refreshPreview()
  }

  function setKeeper(id: number): void {
    if (!bookIds.value.includes(id)) return
    keeperSettled = true
    if (keeperId.value === id) return
    keeperId.value = id
    // The destination defaults to the kept book's folder, so a choice made for another keeper no longer applies.
    destinationId.value = null
    staleChanges.value = null
    schedulePreview()
  }

  function setDestination(id: number | null): void {
    if (id !== null && !bookIds.value.includes(id)) return
    if (destinationId.value === id) return
    destinationId.value = id
    schedulePreview()
  }

  function setFieldChoice(field: BookMergeField, bookId: number): void {
    const entry = preview.value?.fields.find((candidate) => candidate.field === field)
    if (!entry) return
    const next = { ...fieldOverrides.value }
    if (bookId === entry.defaultBookId) delete next[field]
    else next[field] = bookId
    fieldOverrides.value = next
  }

  function chosenBookId(field: BookMergeField): number | null {
    const entry = preview.value?.fields.find((candidate) => candidate.field === field)
    if (!entry) return null
    return fieldOverrides.value[field] ?? entry.defaultBookId
  }

  function setIncludeTag(id: number, include: boolean): void {
    includeTagIds.value = toggleId(includeTagIds.value, id, include)
  }

  function setIncludeGenre(id: number, include: boolean): void {
    includeGenreIds.value = toggleId(includeGenreIds.value, id, include)
  }

  function setDeleteIdenticalCopies(value: boolean): void {
    deleteIdenticalCopies.value = value && preview.value?.canRemoveIdenticalCopies === true
  }

  function setAcknowledgeAccessLoss(value: boolean): void {
    acknowledgedAccessLoss.value = value ? accessLossKey.value : null
  }

  function schedulePreview(): void {
    cancelPreview()
    previewGeneration += 1
    const generation = previewGeneration
    // Loading from the moment of the change: the confirm button must not send a token for the old choice.
    previewLoading.value = true
    previewTimer = setTimeout(() => {
      previewTimer = null
      void runPreview(generation)
    }, MERGE_PREVIEW_DEBOUNCE_MS)
  }

  function refreshPreview(): Promise<BookMergePreviewResponse | null> {
    cancelPreview()
    previewGeneration += 1
    previewLoading.value = true
    return runPreview(previewGeneration)
  }

  async function runPreview(generation: number): Promise<BookMergePreviewResponse | null> {
    const target = keeperId.value
    if (target === null || bookIds.value.length < 2) {
      previewLoading.value = false
      return null
    }

    const controller = new AbortController()
    previewController = controller
    previewError.value = null
    const request: BookMergePreviewRequest = { targetBookId: target, sourceBookIds: sourceIds.value }
    if (destinationId.value !== null) request.destinationBookId = destinationId.value

    try {
      const result = await fetchMergePreview(request, controller.signal)
      if (generation !== previewGeneration) return null
      applyPreview(result)
      if (!keeperSettled) {
        keeperSettled = true
        const recommended = recommendMergeKeeper(result)
        if (recommended !== null && recommended !== target) {
          keeperId.value = recommended
          return await refreshPreview()
        }
      }
      return result
    } catch (error) {
      if (generation !== previewGeneration || controller.signal.aborted) return null
      previewError.value = errorMessage(error, 'book.merge.errors.previewFailed')
      return null
    } finally {
      if (generation === previewGeneration) {
        previewLoading.value = false
        previewController = null
      }
    }
  }

  function applyPreview(result: BookMergePreviewResponse): void {
    preview.value = result
    // Overrides only survive while they still name a real, non-default value of this preview.
    const overrides: Partial<Record<BookMergeField, number>> = {}
    for (const field of result.fields) {
      const chosen = fieldOverrides.value[field.field]
      if (chosen === undefined || chosen === field.defaultBookId) continue
      if (field.candidates.some((candidate) => candidate.bookId === chosen && !isBlankMergeValue(candidate.value))) overrides[field.field] = chosen
    }
    fieldOverrides.value = overrides
    const canOverride = result.visibility.canOverride
    const tagIds = new Set(result.visibility.tags.map((tag) => tag.id))
    const genreIds = new Set(result.visibility.genres.map((genre) => genre.id))
    includeTagIds.value = canOverride ? includeTagIds.value.filter((id) => tagIds.has(id)) : []
    includeGenreIds.value = canOverride ? includeGenreIds.value.filter((id) => genreIds.has(id)) : []
    if (!result.canRemoveIdenticalCopies) deleteIdenticalCopies.value = false
  }

  function buildRequest(previewToken: string, target: number): BookMergeRequest {
    const request: BookMergeRequest = { targetBookId: target, sourceBookIds: sourceIds.value, previewToken }
    if (destinationId.value !== null) request.destinationBookId = destinationId.value
    if (Object.keys(fieldOverrides.value).length > 0) request.fieldOverrides = { ...fieldOverrides.value }
    if (includeTagIds.value.length > 0) request.includeTagIds = [...includeTagIds.value]
    if (includeGenreIds.value.length > 0) request.includeGenreIds = [...includeGenreIds.value]
    if (deleteIdenticalCopies.value) request.deleteIdenticalCopies = true
    // Only a server whose preview asked for it knows the field; older ones reject it.
    if (accessLossAcknowledged.value) request.acknowledgeAccessLoss = true
    return request
  }

  /** Starts the merge. Returns true once the server accepted the job. Never sends twice (F1). */
  async function execute(): Promise<boolean> {
    if (inFlight.value || !canExecute.value) return false
    const current = preview.value
    const target = keeperId.value
    if (!current?.previewToken || target === null) return false

    inFlight.value = true
    executeError.value = null
    staleChanges.value = null
    try {
      const { jobId } = await startMerge(buildRequest(current.previewToken, target))
      beginJob(jobId, target, current)
      return true
    } catch (error) {
      executeError.value = errorMessage(error, 'book.merge.errors.startFailed')
      const code = error instanceof ApiError ? error.errorCode : null
      if (code === MERGE_PREVIEW_STALE || code === MERGE_BLOCKED || code === MERGE_ACCESS_LOSS_NOT_ACKNOWLEDGED) {
        const next = await refreshPreview()
        if (next && code === MERGE_PREVIEW_STALE) staleChanges.value = describePreviewChanges(current, next)
      }
      return false
    } finally {
      inFlight.value = false
    }
  }

  function beginJob(jobId: number, target: number, current: BookMergePreviewResponse): void {
    const sources = sourceIds.value
    job.value = {
      jobId,
      libraryId: mergeDestinationLibraryId(current),
      sourceLibraryIds: [...new Set(current.books.map((book) => book.libraryId))],
      targetBookId: target,
      sourceBookIds: sources,
      status: 'planned',
      processed: 0,
      total: sources.length,
      currentSourceBookId: null,
      outcomes: [],
      result: null,
      errorCode: null,
      bytesTotal: null,
      bytesDone: null,
    }
    pollFailures = 0
    jobUnreachable.value = false
    schedulePoll()
  }

  function applyJobEvent(event: BookMergeJobEvent): void {
    const current = job.value
    if (!current || event.jobId !== current.jobId || isTerminalMergeStatus(current.status)) return
    // A live event proves the job is reachable again after polling gave up.
    pollFailures = 0
    jobUnreachable.value = false
    job.value = {
      ...current,
      status: event.status,
      processed: event.processed,
      total: event.total,
      currentSourceBookId: event.currentSourceBookId,
      outcomes: event.outcomes,
      bytesTotal: event.bytesTotal ?? current.bytesTotal,
      bytesDone: event.bytesDone ?? current.bytesDone,
    }
    if (isTerminalMergeStatus(event.status)) void readFinishedJob(current.jobId)
    else schedulePoll()
  }

  function applyJob(remote: BookMergeJob): void {
    const current = job.value
    if (!current || current.jobId !== remote.id) return
    job.value = {
      ...current,
      libraryId: remote.libraryId,
      targetBookId: remote.targetBookId,
      sourceBookIds: remote.sourceBookIds,
      status: remote.status,
      processed: remote.processed,
      total: remote.total,
      currentSourceBookId: remote.currentSourceBookId,
      outcomes: remote.outcomes,
      result: remote.result,
      errorCode: remote.errorCode,
    }
  }

  function stopPolling(): void {
    if (pollTimer) clearTimeout(pollTimer)
    pollTimer = null
    pollController?.abort()
    pollController = null
  }

  /** Each socket event pushes the next poll back, so a live socket keeps HTTP reads rare. */
  function schedulePoll(): void {
    if (pollTimer) clearTimeout(pollTimer)
    pollTimer = setTimeout(() => {
      pollTimer = null
      void poll()
    }, MERGE_JOB_POLL_MS)
  }

  async function poll(): Promise<void> {
    const current = job.value
    if (!current || isTerminalMergeStatus(current.status)) return
    const controller = new AbortController()
    pollController = controller
    try {
      const remote = await fetchMergeJob(current.jobId, controller.signal)
      pollFailures = 0
      applyJob(remote)
      if (!isTerminalMergeStatus(remote.status)) schedulePoll()
    } catch {
      if (controller.signal.aborted) return
      pollFailures += 1
      if (pollFailures >= MERGE_JOB_POLL_MAX_FAILURES) jobUnreachable.value = true
      else schedulePoll()
    } finally {
      if (pollController === controller) pollController = null
    }
  }

  /** A finished event carries no file counts; one read of the job fills them in. */
  async function readFinishedJob(jobId: number): Promise<void> {
    stopPolling()
    try {
      applyJob(await fetchMergeJob(jobId))
    } catch {
      // The event already said how the merge ended; only the counts are missing.
    }
  }

  return {
    bookIds,
    keeperId,
    sourceIds,
    destinationId,
    fieldOverrides,
    includeTagIds,
    includeGenreIds,
    deleteIdenticalCopies,
    accessLossRequired,
    accessLossAcknowledged,
    preview,
    previewLoading,
    previewError,
    previewCurrent,
    staleChanges,
    inFlight,
    executeError,
    canExecute,
    job,
    jobActive,
    jobFinished,
    jobUnreachable,
    reset,
    start,
    setKeeper,
    setDestination,
    setFieldChoice,
    chosenBookId,
    setIncludeTag,
    setIncludeGenre,
    setDeleteIdenticalCopies,
    setAcknowledgeAccessLoss,
    refreshPreview,
    execute,
  }
}

function toggleId(ids: number[], id: number, include: boolean): number[] {
  const without = ids.filter((existing) => existing !== id)
  return include ? [...without, id] : without
}
