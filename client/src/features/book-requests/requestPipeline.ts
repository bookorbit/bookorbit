import type { BookRequestItem, BookRequestProgressEvent, BookRequestStatus } from '@bookorbit/types'

/**
 * The five stages a request actually moves through, which is not the same list as its eleven
 * statuses: `approved` and `searching` are both "looking for a release", and `grabbed` and
 * `downloading` are both "the client has it".
 */
export const REQUEST_PIPELINE_STEPS = ['asked', 'approved', 'release', 'downloading', 'filed'] as const
export type RequestPipelineStep = (typeof REQUEST_PIPELINE_STEPS)[number]

/** What the step the request is sitting on means, which drives colour and the summary sentence. */
export type RequestPipelineTone = 'waiting' | 'progress' | 'done' | 'failed' | 'stopped'

export interface RequestPipelineState {
  /** Zero-based index into REQUEST_PIPELINE_STEPS of the stage the request is sitting on. */
  currentIndex: number
  tone: RequestPipelineTone
  /** The request stopped here rather than moving on, so later steps will never light up. */
  halted: boolean
}

const STEP_INDEX = {
  asked: 0,
  approved: 1,
  release: 2,
  downloading: 3,
  filed: 4,
} as const satisfies Record<RequestPipelineStep, number>

const DOWNLOAD_STATUS_RANK = {
  queued: 0,
  downloading: 1,
  completed: 2,
  importing: 3,
  needs_review: 4,
  imported: 4,
  failed: 4,
} as const

const TERMINAL_REQUEST_STATUSES = new Set<BookRequestStatus>(['available', 'needs_review', 'failed', 'cancelled', 'rejected'])

export type RequestPipelineInput = Pick<BookRequestItem, 'status' | 'download'>

/** Ignore ticks from a prior attempt and ticks made obsolete by a later fetched download row. */
export function currentRequestProgress(
  request: RequestPipelineInput,
  live: BookRequestProgressEvent | null | undefined,
): BookRequestProgressEvent | null {
  const download = request.download
  if (!download || !live || live.downloadId !== download.id) return null

  const liveRank = DOWNLOAD_STATUS_RANK[live.status]
  const persistedRank = DOWNLOAD_STATUS_RANK[download.status]
  return live.status === download.status || liveRank > persistedRank ? live : null
}

/** The state all request UI should show while its persisted row catches up with live transfer events. */
export function requestPresentationStatus(request: RequestPipelineInput, live?: BookRequestProgressEvent | null): BookRequestStatus {
  if (TERMINAL_REQUEST_STATUSES.has(request.status)) return request.status

  const downloadStatus = currentRequestProgress(request, live)?.status ?? request.download?.status
  switch (downloadStatus) {
    case 'downloading':
      return 'downloading'
    case 'completed':
    case 'importing':
    case 'imported':
      return 'importing'
    case 'needs_review':
      return 'needs_review'
    case 'failed':
      return 'failed'
    default:
      return request.status
  }
}

const BY_STATUS: Record<Exclude<BookRequestStatus, 'failed' | 'cancelled'>, RequestPipelineState> = {
  pending: { currentIndex: STEP_INDEX.approved, tone: 'waiting', halted: false },
  approved: { currentIndex: STEP_INDEX.release, tone: 'progress', halted: false },
  searching: { currentIndex: STEP_INDEX.release, tone: 'progress', halted: false },
  grabbed: { currentIndex: STEP_INDEX.downloading, tone: 'progress', halted: false },
  downloading: { currentIndex: STEP_INDEX.downloading, tone: 'progress', halted: false },
  importing: { currentIndex: STEP_INDEX.filed, tone: 'progress', halted: false },
  needs_review: { currentIndex: STEP_INDEX.filed, tone: 'waiting', halted: false },
  available: { currentIndex: STEP_INDEX.filed, tone: 'done', halted: false },
  rejected: { currentIndex: STEP_INDEX.approved, tone: 'stopped', halted: true },
}

/**
 * Where a request sits, and whether it is still moving.
 *
 * `failed` and `cancelled` carry no stage of their own, so the stage is read off whether a grab
 * ever happened: a request that failed with a download behind it died in transfer, and one that
 * failed without a download never found a release to take. Saying "failed" alone is what the
 * current card does, and it is the least useful thing it could say.
 */
export function requestPipelineState(request: RequestPipelineInput, live?: BookRequestProgressEvent | null): RequestPipelineState {
  const status = requestPresentationStatus(request, live)
  if (status === 'failed') {
    return { currentIndex: request.download ? STEP_INDEX.downloading : STEP_INDEX.release, tone: 'failed', halted: true }
  }
  if (status === 'cancelled') {
    return { currentIndex: request.download ? STEP_INDEX.downloading : STEP_INDEX.approved, tone: 'stopped', halted: true }
  }
  return BY_STATUS[status]
}

/**
 * Whether drawing the five steps tells the reader anything.
 *
 * A finished request renders as five filled nodes reading "Filed" at the end, which is the status
 * chip again in forty times the space. A cancelled or rejected one is the same. The stepper earns
 * its room only while the request is still moving, or when it stopped somewhere worth naming.
 */
export function requestPipelineIsInformative(state: RequestPipelineState): boolean {
  return state.tone !== 'done' && state.tone !== 'stopped'
}

export type RequestStepState = 'done' | 'current' | 'upcoming'

/** `available` is the one status where the final step is behind the request rather than under it. */
export function requestStepState(state: RequestPipelineState, index: number): RequestStepState {
  if (state.tone === 'done') return 'done'
  if (index < state.currentIndex) return 'done'
  if (index === state.currentIndex) return 'current'
  return 'upcoming'
}
