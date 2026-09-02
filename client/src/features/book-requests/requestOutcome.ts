import type { BookRequestItem, BookRequestProgressEvent } from '@bookorbit/types'
import { currentRequestProgress, REQUEST_PIPELINE_STEPS, requestPipelineState } from './requestPipeline'

/**
 * What the Outcome column says about a request, which is a different question from what its status
 * is. The status chip names the state; this names the consequence, and the two together are what
 * the old card was spreading across a stepper, a progress block and three trailing sentences.
 */
export type RequestOutcomeKind = 'progress' | 'failure' | 'settled' | 'waiting'

/**
 * What went wrong, in the reader's language where the server classified it.
 *
 * `statusReason` is English prose written at the point of failure, and most of the paths that
 * write it have never classified anything. Where a code is present it wins, because the prose was
 * only ever the fallback; where it is absent the prose is all there is, and showing English beats
 * showing nothing.
 *
 * `t` is injected for the same reason `formatTime` is below: this stays a pure function of the
 * request, testable without standing up i18n.
 */
export function requestFailureText(
  request: Pick<BookRequestItem, 'statusReason' | 'failureCode' | 'failureMeta'>,
  t: (key: string, named: Record<string, unknown>) => string,
): string | null {
  if (request.failureCode) return t(`bookRequests.handback.${request.failureCode}`, request.failureMeta ?? {})
  return request.statusReason
}

export interface RequestOutcome {
  kind: RequestOutcomeKind
  /** Key under `bookRequests.outcome`, or null when the component renders its own body. */
  key: string | null
  params?: Record<string, string>
}

function isTransferring(request: BookRequestItem, live: BookRequestProgressEvent | null | undefined): boolean {
  const status = currentRequestProgress(request, live)?.status ?? request.download?.status
  return status === 'queued' || status === 'downloading'
}

/**
 * `formatTime` is injected rather than imported so this stays a pure function of the request: the
 * relative formatter is locale-reactive, and a helper that reached for it directly could not be
 * tested without standing up i18n.
 */
export function requestOutcome(
  request: BookRequestItem,
  live: BookRequestProgressEvent | null | undefined,
  formatTime: (iso: string) => string,
): RequestOutcome {
  if (isTransferring(request, live) && request.download) return { kind: 'progress', key: null }
  if (request.status === 'failed') return { kind: 'failure', key: null }

  const settled = formatTime(request.updatedAt)

  switch (request.status) {
    case 'available':
      return request.targetLibraryName
        ? { kind: 'settled', key: 'filedIn', params: { library: request.targetLibraryName, time: settled } }
        : { kind: 'settled', key: 'filed', params: { time: settled } }
    case 'rejected':
      return { kind: 'settled', key: 'rejected', params: { time: settled } }
    case 'cancelled':
      return { kind: 'settled', key: 'cancelled', params: { time: settled } }
    case 'pending':
      return { kind: 'waiting', key: 'awaitingApproval' }
    case 'needs_review':
      return { kind: 'waiting', key: 'awaitingReview' }
    default: {
      // Everything left is mid-flight with nothing transferring yet, so the useful thing to say is
      // which stage it is sitting on rather than repeating the status chip beside it.
      const state = requestPipelineState(request, live)
      return { kind: 'waiting', key: `atStage.${REQUEST_PIPELINE_STEPS[state.currentIndex]}` }
    }
  }
}
