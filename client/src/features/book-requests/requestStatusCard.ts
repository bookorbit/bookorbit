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
export type RequestCardIcon =
  'waiting' | 'search' | 'download' | 'filing' | 'review' | 'failed' | 'done' | 'stopped' | 'upload' | 'paused' | 'checking'

/** What this page knows about an upload it is sending, or one its sender came back to. */
export interface RequestCardUpload {
  /** This page holds the files and is sending them. */
  here: boolean
  fileCount: number
  doneCount: number
  /** Files that are not moving: refused, cut off, or never picked again after a reload. */
  stalledCount: number
  sentBytes: number
  totalBytes: number
}

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
  /** The upload this page is sending for the request, when it is one. */
  upload?: RequestCardUpload | null
  /** Who is looking, so a filed upload only says the requester was told when that is someone else. */
  viewerIsRequester?: boolean
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

function isUpload(request: BookRequestItem): boolean {
  return request.download?.source === 'upload'
}

/** The files arriving, said the way a download's bytes are, for an attempt that is an upload. */
function uploadCard(input: RequestCardInput, base: Pick<RequestCardModel, 'score' | 'path'>): RequestCardModel {
  const { request, live, upload, t, formatBytes } = input
  const download = request.download!
  const fileCount = upload?.fileCount ?? download.uploadFileCount ?? 0
  const doneCount = upload?.doneCount ?? download.uploadFilesReceived ?? 0
  if (upload && upload.stalledCount > 0 && !upload.here) {
    return {
      ...base,
      tone: 'waiting',
      icon: 'paused',
      headline: t('bookRequests.upload.card.paused', { count: upload.stalledCount }),
      sentence: t('bookRequests.upload.card.pausedSentence', { arrived: doneCount, total: fileCount }),
      percent: null,
    }
  }

  const current = currentRequestProgress(request, live)
  const sent = upload?.here ? upload.sentBytes : (current?.downloadedBytes ?? download.downloadedBytes)
  const total = upload?.here ? upload.totalBytes : (current?.totalBytes ?? download.totalBytes ?? 0)
  const named = { sent: formatBytes(sent), size: formatBytes(total), name: download.uploadedByName }
  const sentence = upload?.here
    ? t('bookRequests.upload.card.uploadingHere', named)
    : download.uploadedByName
      ? t('bookRequests.upload.card.uploadingElsewhere', named)
      : t('bookRequests.upload.card.uploadingSoFar', named)
  return {
    ...base,
    tone: 'progress',
    icon: 'upload',
    headline: t('bookRequests.upload.card.uploading', { done: doneCount, total: fileCount }),
    sentence,
    percent: clampPercent(total > 0 ? (sent / total) * 100 : 0),
  }
}

/** An upload's transfer step is named for what it did, as the steps under the card name it. */
function failedStepKey(request: BookRequestItem, index: number): string {
  const step = REQUEST_PIPELINE_STEPS[index]
  if (isUpload(request) && step === 'downloading') return 'bookRequests.upload.steps.uploading'
  return `bookRequests.pipeline.steps.${step}`
}

function filedUploadSentence(input: RequestCardInput): string | null {
  const { request, t } = input
  const medium = request.mediaKind === 'audiobook' ? 'audiobook' : 'ebook'
  const told = !input.viewerIsRequester
  if (request.targetBookId !== null) {
    const named = { title: request.title, requester: request.requesterName }
    return t(told ? `bookRequests.upload.card.joinedTold.${medium}` : `bookRequests.upload.card.joined.${medium}`, named)
  }
  return told ? t('bookRequests.upload.card.told', { requester: request.requesterName }) : null
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
      if (isUpload(request)) return uploadCard(input, base)
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
      if (isUpload(request)) {
        return {
          ...base,
          icon: 'checking',
          headline: t('bookRequests.upload.card.checking'),
          sentence: t('bookRequests.upload.card.checkingSentence', { total: request.download?.uploadFileCount ?? 1 }),
        }
      }
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
      // Cancelling hands the request back rather than failing it, so only the attempt failed.
      if (isUpload(request) && request.status !== 'failed') {
        return {
          ...base,
          tone: 'stopped',
          icon: 'stopped',
          headline: t('bookRequests.upload.card.cancelled'),
          sentence: t('bookRequests.upload.card.cancelledSentence'),
        }
      }
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
        headline: t('bookRequests.pipeline.summary.failed', { step: t(failedStepKey(request, state.currentIndex)) }),
        sentence: failure ?? (isUpload(request) ? request.download?.errorMessage : null) ?? t('bookRequests.outcome.failedUnknown'),
      }
    }
    case 'available':
      if (isUpload(request) && request.targetLibraryName) {
        return {
          ...base,
          icon: 'done',
          headline: t('bookRequests.upload.card.filedIn', { library: request.targetLibraryName }),
          sentence: filedUploadSentence(input),
        }
      }
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
