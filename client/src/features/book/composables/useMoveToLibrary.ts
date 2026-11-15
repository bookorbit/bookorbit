import { computed, getCurrentScope, onScopeDispose, ref } from 'vue'
import { toast } from 'vue-sonner'
import type {
  BookMoveCollisionPolicy,
  BookMoveJobCollisionPolicy,
  BookMovePreviewResult,
  BookMoveProgressEvent,
  BookMoveSummary,
  BookSelectionPayload,
} from '@bookorbit/types'

import { i18n } from '@/i18n'
import { readEventStream } from '@/lib/event-stream'
import { bulkRunIdOf, bulkRunRefusalText, cancelBulkRun, toastWithJobsLink } from '@/features/jobs/lib/bulk-runs'
import * as bookMoveApi from '../api/book-move'

const { t } = i18n.global

export type MoveStep = 'destination' | 'review' | 'progress' | 'done'

export interface MoveProgress {
  processed: number
  total: number
  failed: number
}

export function useMoveToLibrary() {
  const step = ref<MoveStep>('destination')
  const preview = ref<BookMovePreviewResult | null>(null)
  const previewLoading = ref(false)
  const previewError = ref<string | null>(null)

  const progress = ref<MoveProgress | null>(null)
  const summary = ref<BookMoveSummary | null>(null)
  const executeError = ref<string | null>(null)
  /** The bulk run the move became on the server; it goes on if this page stops following it. */
  const runId = ref<string | null>(null)
  /** No book has landed yet: the move waits behind the account's earlier bulk actions, or works on its first book. */
  const waiting = ref(false)
  /** A cancel was asked for and the move has not stopped yet. */
  const cancelling = ref(false)

  /** Per-book policies chosen in the review step; falls back to the job policy. */
  const overrides = ref<Map<number, BookMoveCollisionPolicy>>(new Map())
  // Default to each collision's own suggestion so identical copies merge instead of
  // being duplicated alongside the copy that is already there.
  const jobPolicy = ref<BookMoveJobCollisionPolicy>('suggested')

  let previewController: AbortController | null = null
  let executeController: AbortController | null = null

  if (getCurrentScope()) {
    onScopeDispose(() => {
      previewController?.abort()
      detach()
    })
  }

  const movableCount = computed(() => (preview.value ? preview.value.readyCount + countPlannedCollisions() : 0))

  function countPlannedCollisions(): number {
    const current = preview.value
    if (!current) return 0
    if (current.collisionsTruncated) {
      // Only a bounded sample is available; no suggestion is ever "skip", so the
      // whole set moves unless the user forced skip for the job.
      return jobPolicy.value === 'skip' ? 0 : current.collisionCount
    }
    return current.collisions.filter((collision) => effectivePolicy(collision) !== 'skip').length
  }

  /** Stops following a move in progress; the move itself goes on, and Jobs shows it. */
  function detach(): void {
    const controller = executeController
    if (!controller) return
    executeController = null
    const following = step.value === 'progress' && runId.value !== null
    controller.abort()
    if (following) toastWithJobsLink('info', 'jobsArea.bulk.background')
  }

  function reset(): void {
    previewController?.abort()
    detach()
    previewController = null
    step.value = 'destination'
    preview.value = null
    previewLoading.value = false
    previewError.value = null
    progress.value = null
    summary.value = null
    executeError.value = null
    runId.value = null
    waiting.value = false
    cancelling.value = false
    overrides.value = new Map()
    jobPolicy.value = 'suggested'
  }

  async function loadPreview(
    selection: BookSelectionPayload,
    targetLibraryId: number,
    targetFolderId: number,
  ): Promise<BookMovePreviewResult | null> {
    previewController?.abort()
    previewController = new AbortController()

    previewLoading.value = true
    previewError.value = null
    overrides.value = new Map()

    try {
      const result = await bookMoveApi.fetchMovePreview(selection, targetLibraryId, targetFolderId, previewController.signal)
      preview.value = result
      return result
    } catch (error) {
      if (previewController.signal.aborted) return null
      previewError.value = error instanceof Error ? error.message : 'Failed to prepare the move'
      return null
    } finally {
      previewLoading.value = false
    }
  }

  function setOverride(bookId: number, policy: BookMoveCollisionPolicy): void {
    const next = new Map(overrides.value)
    next.set(bookId, policy)
    overrides.value = next
  }

  /** What will actually happen to one collision, given overrides and the job policy. */
  function effectivePolicy(collision: { bookId: number; suggestedPolicy: BookMoveCollisionPolicy }): BookMoveCollisionPolicy {
    const override = overrides.value.get(collision.bookId)
    if (override) return override
    return jobPolicy.value === 'suggested' ? collision.suggestedPolicy : jobPolicy.value
  }

  function applyPolicyToAll(policy: BookMoveJobCollisionPolicy): void {
    jobPolicy.value = policy
    overrides.value = new Map()
  }

  async function execute(selection: BookSelectionPayload, targetLibraryId: number, targetFolderId: number): Promise<BookMoveSummary | null> {
    const controller = new AbortController()
    executeController = controller
    step.value = 'progress'
    executeError.value = null
    summary.value = null
    runId.value = null
    waiting.value = true
    cancelling.value = false
    progress.value = { processed: 0, total: movableCount.value, failed: 0 }

    try {
      const response = await bookMoveApi.executeMove(
        {
          selection,
          targetLibraryId,
          targetFolderId,
          collisionPolicy: jobPolicy.value,
          overrides: [...overrides.value].map(([bookId, policy]) => ({ bookId, policy })),
        },
        controller.signal,
      )

      if (!response.ok || !response.body) {
        throw new Error(bulkRunRefusalText(response, await readErrorMessage(response)))
      }
      runId.value = bulkRunIdOf(response)

      let finalSummary: BookMoveSummary | null = null
      await readEventStream<BookMoveProgressEvent>(
        response.body,
        (event) => {
          if ('done' in event) {
            finalSummary = event
            summary.value = event
            return
          }
          waiting.value = false
          const current = progress.value ?? { processed: 0, total: 0, failed: 0 }
          progress.value = {
            processed: current.processed + 1,
            total: Math.max(current.total, current.processed + 1),
            failed: current.failed + (event.status === 'failed' ? 1 : 0),
          }
        },
        controller.signal,
      )

      if (controller.signal.aborted) return stopFollowing()
      step.value = 'done'
      // A move that fails on the server ends its stream without a summary; Jobs says why.
      if (!finalSummary) {
        executeError.value = t('jobsArea.bulk.stopped')
        return null
      }
      return finalSummary
    } catch (error) {
      if (controller.signal.aborted) return stopFollowing()
      executeError.value = runId.value ? t('jobsArea.bulk.lost') : error instanceof Error ? error.message : t('jobsArea.bulk.stopped')
      step.value = 'done'
      return null
    } finally {
      if (executeController === controller) executeController = null
      waiting.value = false
      cancelling.value = false
    }
  }

  /** This page stopped following. A reset has already moved on; otherwise the sheet shows what it saw. */
  function stopFollowing(): BookMoveSummary | null {
    if (step.value === 'progress') step.value = 'done'
    return summary.value
  }

  /** Asks the server to stop the move before its next book; the stream's summary then says it was cancelled. */
  async function cancel(): Promise<void> {
    const id = runId.value
    if (!id) {
      executeController?.abort()
      return
    }
    if (cancelling.value) return
    cancelling.value = true
    try {
      await cancelBulkRun(id)
    } catch {
      cancelling.value = false
      toast.error(t('jobsArea.bulk.cancelFailed'))
    }
  }

  return {
    step,
    preview,
    previewLoading,
    previewError,
    progress,
    summary,
    executeError,
    runId,
    waiting,
    cancelling,
    overrides,
    jobPolicy,
    movableCount,
    reset,
    loadPreview,
    setOverride,
    effectivePolicy,
    applyPolicyToAll,
    execute,
    cancel,
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string | string[] }
    if (Array.isArray(body.message)) return body.message.join(', ')
    if (body.message) return body.message
  } catch {
    // Fall through to the status code below.
  }
  return `HTTP ${response.status}`
}
