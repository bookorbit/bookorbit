import { getCurrentScope, onScopeDispose, ref, type Ref } from 'vue'
import { toast } from 'vue-sonner'
import type { BulkRunKind } from '@bookorbit/types'

import { i18n } from '@/i18n'
import { readEventStream } from '@/lib/event-stream'
import { bulkRunIdOf, cancelBulkRun, toastWithJobsLink } from '../lib/bulk-runs'

const { t } = i18n.global

/** A bulk run this page follows, as its progress pill shows it. */
export interface BulkRunInFlight {
  kind: BulkRunKind
  /** Null until the server names the run, and for an empty selection, which it answers at once. */
  runId: string | null
  /** No item has finished yet: the run waits behind the account's earlier bulk actions, or works on its first item. */
  waiting: boolean
  processed: number
  total: number
  failed: number
  /** A cancel was asked for and the run has not stopped yet. */
  cancelling: boolean
}

/**
 * How following a run ended. `done`: its final event arrived. `detached`: the page stopped
 * following and the run goes on without it. `stopped`: the server ended the stream without a final
 * event, which a failed run does. `lost`: the connection broke and the run may still be going.
 */
export type BulkRunFollowEnd = 'done' | 'detached' | 'stopped' | 'lost'

export interface BulkRunFollowResult {
  end: BulkRunFollowEnd
  /** The run stopped early because this page asked it to. */
  cancelled: boolean
  /** Items this page saw finish. */
  processed: number
  total: number
}

/** One run as its caller drives it, from the request to the last event. */
export interface BulkRunHandle {
  /** Detaches the request and its stream when the page stops following; the run itself goes on. */
  readonly signal: AbortSignal
  /** Follows the run's stream. `onEvent` answers true for the final event. */
  follow<E>(response: Response, onEvent: (event: E) => boolean): Promise<BulkRunFollowResult>
  /** One item finished. */
  advance(failed?: boolean): void
  /** The run started on the server, now knowing its real size. */
  started(total: number): void
  /** Stops showing the run, when it never got going. Safe to call more than once. */
  end(): void
}

/**
 * Follows the bulk run a page started: what its progress pill shows, Cancel, and letting it go on
 * in the background. A run lives on the server, so leaving the page only stops following it.
 */
export function useBulkRunTracker(): {
  inFlight: Ref<BulkRunInFlight | null>
  begin: (kind: BulkRunKind, total: number) => BulkRunHandle
  cancel: () => Promise<void>
  detach: () => void
} {
  const inFlight = ref<BulkRunInFlight | null>(null)
  let current: { controller: AbortController; cancelAsked: boolean } | null = null

  function begin(kind: BulkRunKind, total: number): BulkRunHandle {
    current?.controller.abort()
    const entry = { controller: new AbortController(), cancelAsked: false }
    current = entry
    inFlight.value = { kind, runId: null, waiting: true, processed: 0, total, failed: 0, cancelling: false }

    const isCurrent = () => current === entry
    const update = (patch: (value: BulkRunInFlight) => Partial<BulkRunInFlight>) => {
      if (isCurrent() && inFlight.value) inFlight.value = { ...inFlight.value, ...patch(inFlight.value) }
    }
    const end = () => {
      if (!isCurrent()) return
      current = null
      inFlight.value = null
    }

    return {
      signal: entry.controller.signal,
      advance(failed = false) {
        update((value) => ({
          waiting: false,
          processed: value.processed + 1,
          total: Math.max(value.total, value.processed + 1),
          failed: value.failed + (failed ? 1 : 0),
        }))
      },
      started(size: number) {
        update(() => ({ waiting: false, total: size }))
      },
      end,
      async follow<E>(response: Response, onEvent: (event: E) => boolean): Promise<BulkRunFollowResult> {
        const signal = entry.controller.signal
        const runId = bulkRunIdOf(response)
        update(() => ({ runId }))
        let finished = false
        let outcome: BulkRunFollowEnd
        try {
          if (!response.body) throw new Error('The bulk action answered without a stream')
          await readEventStream<E>(
            response.body,
            (event) => {
              if (onEvent(event)) finished = true
            },
            signal,
          )
          outcome = finished ? 'done' : signal.aborted ? 'detached' : 'stopped'
        } catch {
          outcome = finished ? 'done' : signal.aborted ? 'detached' : runId ? 'lost' : 'stopped'
        }
        const seen = isCurrent() && inFlight.value ? inFlight.value : { processed: 0, total: 0 }
        const result: BulkRunFollowResult = {
          end: outcome,
          cancelled: entry.cancelAsked && seen.processed < seen.total,
          processed: seen.processed,
          total: seen.total,
        }
        end()
        if (outcome === 'stopped') toastWithJobsLink('error', 'jobsArea.bulk.stopped')
        else if (outcome === 'lost') toastWithJobsLink('info', 'jobsArea.bulk.lost')
        return result
      },
    }
  }

  /** Asks the server to stop the run before its next item; the stream's final event then says it stopped. */
  async function cancel(): Promise<void> {
    const entry = current
    const value = inFlight.value
    if (!entry || !value?.runId || value.cancelling) return
    entry.cancelAsked = true
    inFlight.value = { ...value, cancelling: true }
    try {
      await cancelBulkRun(value.runId)
    } catch {
      entry.cancelAsked = false
      if (current === entry && inFlight.value) inFlight.value = { ...inFlight.value, cancelling: false }
      toast.error(t('jobsArea.bulk.cancelFailed'))
    }
  }

  /** Stops following the run and says where to find it; the run itself goes on. */
  function detach(): void {
    const entry = current
    if (!entry) return
    const known = inFlight.value?.runId !== null && inFlight.value?.runId !== undefined
    current = null
    inFlight.value = null
    entry.controller.abort()
    if (known) toastWithJobsLink('info', 'jobsArea.bulk.background')
  }

  if (getCurrentScope()) onScopeDispose(detach)

  return { inFlight, begin, cancel, detach }
}
