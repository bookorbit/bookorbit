import { computed, onUnmounted, ref } from 'vue'
import type {
  BookMoveCollisionPolicy,
  BookMoveJobCollisionPolicy,
  BookMovePreviewResult,
  BookMoveProgressEvent,
  BookMoveSummary,
  BookSelectionPayload,
} from '@bookorbit/types'

import * as bookMoveApi from '../api/book-move'

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

  /** Per-book policies chosen in the review step; falls back to the job policy. */
  const overrides = ref<Map<number, BookMoveCollisionPolicy>>(new Map())
  // Default to each collision's own suggestion so identical copies merge instead of
  // being duplicated alongside the copy that is already there.
  const jobPolicy = ref<BookMoveJobCollisionPolicy>('suggested')

  let previewController: AbortController | null = null
  let executeController: AbortController | null = null

  onUnmounted(() => {
    previewController?.abort()
    executeController?.abort()
  })

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

  function reset(): void {
    previewController?.abort()
    executeController?.abort()
    previewController = null
    executeController = null
    step.value = 'destination'
    preview.value = null
    previewLoading.value = false
    previewError.value = null
    progress.value = null
    summary.value = null
    executeError.value = null
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
    executeController = new AbortController()
    step.value = 'progress'
    executeError.value = null
    summary.value = null
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
        executeController.signal,
      )

      if (!response.ok || !response.body) {
        throw new Error(await readErrorMessage(response))
      }

      const finalSummary = await consumeStream(response.body, (event) => {
        if ('done' in event) {
          summary.value = event
          return
        }
        const current = progress.value ?? { processed: 0, total: 0, failed: 0 }
        progress.value = {
          processed: current.processed + 1,
          total: Math.max(current.total, current.processed + 1),
          failed: current.failed + (event.status === 'failed' ? 1 : 0),
        }
      })

      if (finalSummary) summary.value = finalSummary
      if (!summary.value) throw new Error('The move ended unexpectedly')

      step.value = 'done'
      return summary.value
    } catch (error) {
      if (executeController.signal.aborted) {
        step.value = 'done'
        return summary.value
      }
      executeError.value = error instanceof Error ? error.message : 'The move failed'
      step.value = 'done'
      return null
    } finally {
      executeController = null
    }
  }

  function cancel(): void {
    executeController?.abort()
  }

  return {
    step,
    preview,
    previewLoading,
    previewError,
    progress,
    summary,
    executeError,
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

/**
 * Reads the server-sent event stream. Lines are buffered across chunks because an
 * event can straddle a network chunk boundary; splitting each chunk on its own
 * silently drops those events.
 */
async function consumeStream(body: ReadableStream<Uint8Array>, onEvent: (event: BookMoveProgressEvent) => void): Promise<BookMoveSummary | null> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalSummary: BookMoveSummary | null = null

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const raw = line.slice(6).trim()
        if (!raw) continue

        try {
          const event = JSON.parse(raw) as BookMoveProgressEvent
          if ('done' in event) finalSummary = event
          onEvent(event)
        } catch {
          // A malformed frame should not abort a job that is otherwise fine.
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
  }

  return finalSummary
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
