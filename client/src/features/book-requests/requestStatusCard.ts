import type { BookRequestHandbackCode, BookRequestItem, BookRequestProgressEvent, BookRequestReview } from '@bookorbit/types'
import { requestFailureText } from './requestOutcome'
import {
  currentRequestProgress,
  requestPipelineState,
  requestPresentationStatus,
  REQUEST_PIPELINE_STEPS,
  type RequestPipelineTone,
} from './requestPipeline'

/** Which picture leads the card; the component maps these to icons. */
export type RequestCardIcon = 'waiting' | 'search' | 'download' | 'filing' | 'review' | 'failed' | 'done' | 'stopped'

export interface RequestCardModel {
  tone: RequestPipelineTone
  icon: RequestCardIcon
  headline: string
  sentence: string | null
  /** A live transfer: the bar under the sentence and the figure beside the headline. */
  percent: number | null
  /** A held import with a score: drawn as a meter against the threshold that files it. */
  score: { score: number; threshold: number } | null
  /** Files the server could not read, shown in a block of their own so the path can be copied. */
  path: string | null
}

export interface RequestCardInput {
  request: BookRequestItem
  live: BookRequestProgressEvent | null
  review: BookRequestReview | null
  /** Whether this viewer is the one who approves or rejects, which is who the pending card speaks to. */
  canDecide: boolean
  /** The client still holds the finished download as a seed, where that has been read. */
  seeding: boolean | null
  t: (key: string, named?: Record<string, unknown>) => string
  formatBytes: (bytes: number) => string
  relativeTime: (iso: string) => string
}

/** A kind a newer server sends that this build has no sentence for reads as a book. */
const PENDING_MEDIA = new Set<string>(['ebook', 'audiobook', 'comic'])

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function transferSentence(input: RequestCardInput): string | null {
  const { request, live, t, formatBytes } = input
  const download = request.download
  if (!download) return null
  const current = currentRequestProgress(request, live)
  const done = current?.downloadedBytes ?? download.downloadedBytes
  const total = current?.totalBytes ?? download.totalBytes
  const client = download.downloadClientName
  if (total) {
    const named = { done: formatBytes(done), total: formatBytes(total), client }
    return client ? t('bookRequests.statusCard.transferredIn', named) : t('bookRequests.download.transferred', named)
  }
  return done > 0 ? t('bookRequests.download.transferredUnknown', { done: formatBytes(done) }) : null
}

function reviewSentence(review: BookRequestReview, t: RequestCardInput['t']): string {
  if (review.bookDockFileId === null) return t('bookRequests.review.missingEntry')
  if (review.heldOnRequest) return t('bookRequests.review.heldOnRequest')
  const detail = review.verification
  if (!detail) return t('bookRequests.review.verificationOff')
  // The score of a file vetoed on its edition says nothing: its title and author matched.
  if (detail.reason === 'edition_mismatch') return t('bookRequests.review.editionHeld')
  const named = { score: detail.score, threshold: detail.threshold }
  return detail.passed ? t('bookRequests.review.scoreClears', named) : t('bookRequests.review.scoreShort', named)
}

/**
 * What the status card says, in the one place the drawer says it.
 *
 * Copy comes from the catalog's existing outcome, download, review and hand-back messages wherever
 * one already says the thing; the card adds only the sentences nothing else had a reason to say.
 */
export function requestCardModel(input: RequestCardInput): RequestCardModel {
  const { request, live, review, t } = input
  const state = requestPipelineState(request, live)
  const status = requestPresentationStatus(request, live)
  const failure = requestFailureText(request, (key, named) => t(key, named))
  const base = { tone: state.tone, percent: null, score: null, path: null }

  switch (status) {
    case 'pending':
      return {
        ...base,
        icon: 'waiting',
        headline: t('bookRequests.outcome.awaitingApproval'),
        sentence: input.canDecide
          ? t(`bookRequests.statusCard.pendingDecide.${PENDING_MEDIA.has(request.mediaKind) ? request.mediaKind : 'other'}`, {
              requester: request.requesterName,
            })
          : null,
      }
    case 'approved':
    case 'searching':
      return {
        ...base,
        icon: 'search',
        headline: failure
          ? t('bookRequests.nextStep.needsRelease')
          : t(`bookRequests.outcome.atStage.${status === 'searching' ? 'release' : 'approved'}`),
        sentence: failure,
      }
    case 'grabbed':
    case 'downloading': {
      const current = currentRequestProgress(request, live)
      const downloadStatus = current?.status ?? request.download?.status ?? 'queued'
      const percent = current?.progressPercent ?? request.download?.progressPercent ?? 0
      return {
        ...base,
        icon: 'download',
        headline: t(`bookRequests.download.status.${downloadStatus === 'queued' ? 'queued' : 'downloading'}`),
        sentence: transferSentence(input),
        percent: clampPercent(percent),
      }
    }
    case 'importing':
      return { ...base, icon: 'filing', headline: t('bookRequests.download.status.importing'), sentence: null }
    case 'needs_review': {
      const verification = review?.bookDockFileId !== null ? (review?.verification ?? null) : null
      return {
        ...base,
        icon: 'review',
        headline: t('bookRequests.outcome.awaitingReview'),
        sentence: review ? reviewSentence(review, t) : failure,
        score: verification && verification.reason !== 'edition_mismatch' ? { score: verification.score, threshold: verification.threshold } : null,
      }
    }
    case 'failed': {
      const path = request.failureCode === UNREADABLE_FILES_CODE ? readPath(request) : null
      if (path) {
        const client = request.download?.downloadClientName ?? null
        const key = client ? (input.seeding ? 'unreadableSeeding' : 'unreadableClient') : 'unreadable'
        return {
          ...base,
          icon: 'failed',
          headline: t('bookRequests.statusCard.unreadableTitle'),
          sentence: t(`bookRequests.statusCard.${key}`, { client }),
          path,
        }
      }
      return {
        ...base,
        icon: 'failed',
        headline: t('bookRequests.pipeline.summary.failed', { step: t(`bookRequests.pipeline.steps.${REQUEST_PIPELINE_STEPS[state.currentIndex]}`) }),
        sentence: failure ?? t('bookRequests.outcome.failedUnknown'),
      }
    }
    case 'available':
      return {
        ...base,
        icon: 'done',
        headline: t('bookRequests.download.status.imported'),
        sentence: request.targetLibraryName
          ? t('bookRequests.outcome.filedIn', { library: request.targetLibraryName, time: input.relativeTime(request.updatedAt) })
          : t('bookRequests.outcome.filed', { time: input.relativeTime(request.updatedAt) }),
      }
    case 'rejected':
    case 'cancelled':
      return { ...base, icon: 'stopped', headline: t(`bookRequests.status.${status}`), sentence: null }
  }
}

/** The server's code for a finished download whose files could not be read when filing. */
export const UNREADABLE_FILES_CODE: BookRequestHandbackCode = 'DOWNLOAD_UNREADABLE'

function readPath(request: Pick<BookRequestItem, 'failureMeta'>): string | null {
  const path = request.failureMeta?.path
  return typeof path === 'string' && path.trim() !== '' ? path : null
}
