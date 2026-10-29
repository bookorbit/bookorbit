import {
  isReadAloudErrorCode,
  READ_ALOUD_ACTIVE_JOB_STATUSES,
  type ReadAloudCapability,
  type ReadAloudChapterStatus,
  type ReadAloudEligibilityReason,
  type ReadAloudErrorCode,
  type ReadAloudJob,
  type ReadAloudJobEvent,
  type ReadAloudJobStage,
  type ReadAloudJobStatus,
  type ReadAloudStageUnit,
} from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'

const ACTIVE_STATUSES = new Set<ReadAloudJobStatus>(READ_ALOUD_ACTIVE_JOB_STATUSES)

/** Queued, processing or waiting for review: the job holds the book's slot and can still change. */
export function isActiveJob(job: ReadAloudJob | null | undefined): job is ReadAloudJob {
  return job != null && ACTIVE_STATUSES.has(job.status)
}

export function isRunningJob(job: ReadAloudJob | null | undefined): job is ReadAloudJob {
  return job != null && (job.status === 'queued' || job.status === 'processing')
}

export function isCompletedJob(job: ReadAloudJob | null | undefined): job is ReadAloudJob {
  return job != null && (job.status === 'completed' || job.status === 'completed_with_warnings')
}

export type ReadAloudCoverageSummary = {
  /** Sentences with narration timing, matched or estimated between matches. */
  matched: number
  /** The text the narration covers; the whole EPUB for jobs validated before coverage was recorded. */
  total: number
  /** Share of the audio placed against text, or null without a duration. */
  audioFraction: number | null
  outsideTitles: string[]
  /** Chapters outside the narration beyond the titles listed. */
  outsideMore: number
}

/** The numbers a finished or reviewable job shows: how much matched, and what the narration never covers. */
export function coverageSummary(job: Pick<ReadAloudJob, 'report' | 'coverage'>): ReadAloudCoverageSummary | null {
  const report = job.report
  if (!report || report.sentences <= 0) return null
  const coverage = job.coverage
  const total = coverage ? coverage.storySentences : report.sentences
  return {
    matched: Math.min(total, report.matchedSentences + report.interpolatedSentences),
    total,
    audioFraction: report.seconds > 0 ? Math.min(1, (report.matchedSeconds + report.interpolatedSeconds) / report.seconds) : null,
    outsideTitles: coverage?.outsideTitles ?? [],
    outsideMore: coverage ? Math.max(0, coverage.outsideChapterCount - coverage.outsideTitles.length) : 0,
  }
}

/**
 * Reasons that only an admin or a library change can clear. A button that can never work on this
 * book is noise on every visit, so the entry stays out of the toolbar entirely.
 */
const HIDDEN_REASONS = new Set<ReadAloudEligibilityReason>(['worker_not_configured', 'single_file_library', 'no_audiobook'])

const REASON_KEYS: Record<Exclude<ReadAloudEligibilityReason, 'worker_not_configured' | 'single_file_library' | 'no_audiobook'>, string> = {
  worker_unavailable: 'book.detail.files.readAloud.reasons.worker_unavailable',
  worker_incompatible: 'book.detail.files.readAloud.reasons.worker_incompatible',
  book_missing: 'book.detail.files.readAloud.reasons.book_missing',
  no_epub: 'book.detail.files.readAloud.reasons.no_epub',
  too_many_audio_files: 'book.detail.files.readAloud.reasons.too_many_audio_files',
  epub_not_allowed: 'book.detail.files.readAloud.reasons.epub_not_allowed',
  library_not_mounted: 'book.detail.files.readAloud.reasons.library_not_mounted',
  job_active: 'book.detail.files.readAloud.reasons.job_active',
}
const NO_EPUB_WITH_EXISTING_KEY = 'book.detail.files.readAloud.reasons.no_epub_existing'
const UNKNOWN_REASON_KEY = 'book.detail.files.readAloud.reasons.unknown'

export type ReadAloudEntryState =
  | { kind: 'hidden' }
  | { kind: 'available' }
  | { kind: 'unavailable'; reason: ReadAloudEligibilityReason | null; reasonKey: string }
  | { kind: 'loadFailed' }

export function resolveReadAloudEntry(input: {
  enabled: boolean
  capability: ReadAloudCapability | null
  loadFailed: boolean
  job: ReadAloudJob | null
}): ReadAloudEntryState {
  const { enabled, capability, loadFailed, job } = input
  if (!enabled) return { kind: 'hidden' }
  if (!capability) return loadFailed ? { kind: 'loadFailed' } : { kind: 'hidden' }
  if (!capability.workerConfigured) return { kind: 'hidden' }
  const reason = capability.reason
  if (reason !== null && HIDDEN_REASONS.has(reason)) return { kind: 'hidden' }
  if (isActiveJob(job)) return { kind: 'unavailable', reason: 'job_active', reasonKey: REASON_KEYS.job_active }
  if (reason === 'no_epub' && capability.existingReadAlongs.length > 0) {
    return { kind: 'unavailable', reason, reasonKey: NO_EPUB_WITH_EXISTING_KEY }
  }
  if (reason !== null) {
    const key = (REASON_KEYS as Partial<Record<ReadAloudEligibilityReason, string>>)[reason] ?? UNKNOWN_REASON_KEY
    return { kind: 'unavailable', reason, reasonKey: key }
  }
  if (!capability.eligible) return { kind: 'unavailable', reason: null, reasonKey: UNKNOWN_REASON_KEY }
  return { kind: 'available' }
}

/**
 * The line under the Files toolbar when the entry cannot start a job, or null. A check that fails
 * again on retry says how often, so a repeat failure never reads as nothing having happened.
 */
export function readAloudEntryNote(
  entry: ReadAloudEntryState,
  context: { failedChecks: number; jobCardShown: boolean },
  t: (key: string, values?: Record<string, unknown>) => string,
): string | null {
  if (entry.kind === 'loadFailed') {
    const retries = context.failedChecks - 1
    return retries > 0 ? t('book.detail.files.readAloud.loadFailedAgain', { count: retries }) : t('book.detail.files.readAloud.loadFailed')
  }
  if (entry.kind !== 'unavailable') return null
  // The job card right below already says a job is running, and says more.
  if (entry.reason === 'job_active' && context.jobCardShown) return null
  return t(entry.reasonKey)
}

const ERROR_KEYS: Record<ReadAloudErrorCode, string> = {
  worker_unavailable: 'book.detail.files.readAloud.errors.job.worker_unavailable',
  worker_incompatible: 'book.detail.files.readAloud.errors.job.worker_incompatible',
  worker_crashed: 'book.detail.files.readAloud.errors.job.worker_crashed',
  library_not_mounted: 'book.detail.files.readAloud.errors.job.library_not_mounted',
  source_missing: 'book.detail.files.readAloud.errors.job.source_missing',
  source_changed: 'book.detail.files.readAloud.errors.job.source_changed',
  invalid_source: 'book.detail.files.readAloud.errors.job.invalid_source',
  unsupported_language: 'book.detail.files.readAloud.errors.job.unsupported_language',
  insufficient_storage: 'book.detail.files.readAloud.errors.job.insufficient_storage',
  audio_processing_failed: 'book.detail.files.readAloud.errors.job.audio_processing_failed',
  model_download_failed: 'book.detail.files.readAloud.errors.job.model_download_failed',
  inference_failed: 'book.detail.files.readAloud.errors.job.inference_failed',
  markup_failed: 'book.detail.files.readAloud.errors.job.markup_failed',
  alignment_failed: 'book.detail.files.readAloud.errors.job.alignment_failed',
  invalid_output: 'book.detail.files.readAloud.errors.job.invalid_output',
  publication_failed: 'book.detail.files.readAloud.errors.job.publication_failed',
  review_expired: 'book.detail.files.readAloud.errors.job.review_expired',
  discarded: 'book.detail.files.readAloud.errors.job.discarded',
  cancelled: 'book.detail.files.readAloud.errors.job.cancelled',
  unknown: 'book.detail.files.readAloud.errors.job.unknown',
}

/** A code this build does not know reads as `unknown` rather than as a raw translation key. */
export function jobErrorMessageKey(code: string | null, te: (key: string) => boolean): string {
  const key = isReadAloudErrorCode(code) ? ERROR_KEYS[code] : ERROR_KEYS.unknown
  return te(key) ? key : ERROR_KEYS.unknown
}

const STAGE_KEYS: Record<ReadAloudJobStage, string> = {
  queued: 'book.detail.files.readAloud.stages.queued',
  preparing_audio: 'book.detail.files.readAloud.stages.preparing_audio',
  downloading_model: 'book.detail.files.readAloud.stages.downloading_model',
  generating_emissions: 'book.detail.files.readAloud.stages.generating_emissions',
  marking_up_ebook: 'book.detail.files.readAloud.stages.marking_up_ebook',
  aligning: 'book.detail.files.readAloud.stages.aligning',
  validating: 'book.detail.files.readAloud.stages.validating',
  awaiting_review: 'book.detail.files.readAloud.stages.awaiting_review',
  publishing: 'book.detail.files.readAloud.stages.publishing',
  completed: 'book.detail.files.readAloud.stages.completed',
}

/** Unknown stages from a newer server fall back to the generic "working" label. */
export function stageLabelKey(stage: string | null): string {
  return (stage && (STAGE_KEYS as Record<string, string>)[stage]) || 'book.detail.files.readAloud.stages.working'
}

const STAGE_UNIT_KEYS: Record<ReadAloudStageUnit, string> = {
  file: 'book.detail.files.readAloud.stageDetail.file',
  track: 'book.detail.files.readAloud.stageDetail.track',
  chapter: 'book.detail.files.readAloud.stageDetail.chapter',
}

export function stageDetailKey(unit: string): string {
  return (STAGE_UNIT_KEYS as Record<string, string>)[unit] ?? 'book.detail.files.readAloud.stageDetail.step'
}

const DEVICE_KEYS: Record<string, string> = {
  cpu: 'book.detail.files.readAloud.devices.cpu',
  mlx: 'book.detail.files.readAloud.devices.mlx',
  cuda: 'book.detail.files.readAloud.devices.cuda',
  webgpu: 'book.detail.files.readAloud.devices.webgpu',
}

export function deviceLabel(device: string | null, t: (key: string, values?: Record<string, unknown>) => string): string | null {
  if (!device) return null
  const key = DEVICE_KEYS[device]
  return key ? t(key) : t('book.detail.files.readAloud.devices.other', { device })
}

/** The worker's own stages, grouped into the steps the card's stepper shows. */
export const READ_ALOUD_STEPS = [
  { key: 'audio', stages: ['preparing_audio'] },
  { key: 'speech', stages: ['downloading_model', 'generating_emissions'] },
  { key: 'text', stages: ['marking_up_ebook'] },
  { key: 'align', stages: ['aligning'] },
  { key: 'check', stages: ['validating'] },
  { key: 'publish', stages: ['awaiting_review', 'publishing', 'completed'] },
] as const satisfies readonly { key: string; stages: readonly ReadAloudJobStage[] }[]

export type ReadAloudStepKey = (typeof READ_ALOUD_STEPS)[number]['key']

/** Index of the step a stage belongs to; -1 while queued or for a stage this build does not know. */
export function stepIndexOf(stage: string): number {
  return READ_ALOUD_STEPS.findIndex((step) => (step.stages as readonly string[]).includes(stage))
}

const CHAPTER_STATUS_KEYS: Record<ReadAloudChapterStatus, string> = {
  aligned: 'book.detail.files.readAloud.review.status.aligned',
  'not-found': 'book.detail.files.readAloud.review.status.notFound',
  'too-short': 'book.detail.files.readAloud.review.status.tooShort',
  excluded: 'book.detail.files.readAloud.review.status.excluded',
  'audio-only': 'book.detail.files.readAloud.review.status.audioOnly',
}

/** A chapter before the narration starts or after it ends, which is expected to have no audio. */
export const OUTSIDE_NARRATION_STATUS_KEY = 'book.detail.files.readAloud.review.status.outside'

export function chapterStatusKey(status: string): string {
  return (CHAPTER_STATUS_KEYS as Record<string, string>)[status] ?? 'book.detail.files.readAloud.review.status.unknown'
}

/** Event codes the server and worker emit. Copy comes from these, never from the English `message`. */
const EVENTS = 'book.detail.files.readAloud.log.events'

const EVENT_CODES = new Set([
  'job_created',
  'claimed',
  'job_accepted',
  'disk_checked',
  'disk_check_failed',
  'stage_started',
  'stage_finished',
  'stage_skipped',
  'stage_failed',
  'model_download_started',
  'model_download_finished',
  'emissions_cached',
  'audio_reencoded_cbr',
  'stalign_warning',
  'waiting_for_worker',
  'worker_reachable_again',
  'worker_lost_job',
  'requeued',
  'recovered',
  'output_validated',
  'needs_review',
  'publish_requested',
  'published',
  'file_added',
  'file_replaced',
  'file_already_attached',
  'replace_target_missing',
  'replace_not_permitted',
  'job_completed',
  'cancel_requested',
  'runner_killed',
  'job_cancelled',
  'cancelled',
  'discarded',
  'job_failed',
  'retry_requested',
  'resync_requested',
  'review_reminder_sent',
  'review_expired',
])

export type ReadAloudEventText = {
  /** Localized summary from the event code. */
  text: string
  /** The raw diagnostic message, shown for problems and for codes this build does not know. */
  detail: string | null
}

/** Seconds, minutes or hours as a locale-formatted unit, for how long one step took. */
export function formatStepDuration(ms: number): string {
  const seconds = Math.max(0, ms) / 1000
  if (seconds < 60) return formatNumber(seconds, { style: 'unit', unit: 'second', unitDisplay: 'short', maximumFractionDigits: seconds < 10 ? 1 : 0 })
  if (seconds < 3600) return formatNumber(seconds / 60, { style: 'unit', unit: 'minute', unitDisplay: 'short', maximumFractionDigits: 0 })
  return formatNumber(seconds / 3600, { style: 'unit', unit: 'hour', unitDisplay: 'short', maximumFractionDigits: 1 })
}

export function eventText(
  event: ReadAloudJobEvent,
  t: (key: string, values?: Record<string, unknown>) => string,
  te: (key: string) => boolean,
): ReadAloudEventText {
  const detail = event.level === 'info' ? null : event.message
  if (EVENT_CODES.has(event.code)) {
    const durationMs = typeof event.data?.durationMs === 'number' ? event.data.durationMs : null
    if (event.code === 'stage_finished' && durationMs === null) return { text: t(`${EVENTS}.stage_finished_plain`), detail }
    return { text: t(`${EVENTS}.${event.code}`, durationMs === null ? {} : { duration: formatStepDuration(durationMs) }), detail }
  }
  if (isReadAloudErrorCode(event.code)) return { text: t(jobErrorMessageKey(event.code, te)), detail: event.message }
  return { text: t('book.detail.files.readAloud.log.other'), detail: event.message ?? event.code }
}

const NOTIFICATIONS = 'notifications.readAloud'

export type ReadAloudNotificationCopy = { title: string; message: string | null }

/**
 * The reader's-locale copy for a read-aloud notification, from the book title and error code the
 * server stores in `meta`. Null for other types, and for notifications stored before `meta`
 * carried the title, which keep the server's English fallback.
 */
export function readAloudNotificationCopy(
  notification: { type: string; meta: Record<string, unknown> | null },
  t: (key: string, values?: Record<string, unknown>) => string,
  te: (key: string) => boolean,
): ReadAloudNotificationCopy | null {
  const meta = notification.meta
  if (!meta || !Object.hasOwn(meta, 'bookTitle')) return null
  const stored = typeof meta.bookTitle === 'string' ? meta.bookTitle.trim() : ''
  const title = stored || t(`${NOTIFICATIONS}.untitledBook`)
  switch (notification.type) {
    case 'read_aloud_ready':
      return { title: t(`${NOTIFICATIONS}.readyTitle`, { title }), message: null }
    case 'read_aloud_needs_review':
      return { title: t(`${NOTIFICATIONS}.needsReviewTitle`, { title }), message: t(`${NOTIFICATIONS}.needsReviewMessage`) }
    case 'read_aloud_failed':
      return {
        title: t(`${NOTIFICATIONS}.failedTitle`, { title }),
        message: t(jobErrorMessageKey(typeof meta.errorCode === 'string' ? meta.errorCode : null, te)),
      }
    case 'read_aloud_review_expiring':
      return { title: t(`${NOTIFICATIONS}.reviewExpiringTitle`, { title }), message: t(`${NOTIFICATIONS}.reviewExpiringMessage`) }
    default:
      return null
  }
}

/** Hours and minutes, never seconds: everything here runs for minutes to hours. */
export function formatReadAloudDuration(seconds: number, t: (key: string, values?: Record<string, unknown>) => string): string {
  const safe = Math.max(0, seconds)
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  if (hours > 0) return t('book.detail.files.duration.hoursMinutes', { hours, minutes })
  return t('book.detail.files.duration.minutes', { minutes: Math.max(minutes, 1) })
}

export const READ_ALOUD_I18N_KEYS = {
  reasons: [...Object.values(REASON_KEYS), NO_EPUB_WITH_EXISTING_KEY, UNKNOWN_REASON_KEY],
  errors: Object.values(ERROR_KEYS),
  stages: [...Object.values(STAGE_KEYS), 'book.detail.files.readAloud.stages.working'],
  stageUnits: [...Object.values(STAGE_UNIT_KEYS), 'book.detail.files.readAloud.stageDetail.step'],
  devices: [...Object.values(DEVICE_KEYS), 'book.detail.files.readAloud.devices.other'],
  chapterStatuses: [...Object.values(CHAPTER_STATUS_KEYS), OUTSIDE_NARRATION_STATUS_KEY, 'book.detail.files.readAloud.review.status.unknown'],
  events: [...[...EVENT_CODES].map((code) => `${EVENTS}.${code}`), `${EVENTS}.stage_finished_plain`, 'book.detail.files.readAloud.log.other'],
  notifications: [
    'readyTitle',
    'needsReviewTitle',
    'needsReviewMessage',
    'failedTitle',
    'reviewExpiringTitle',
    'reviewExpiringMessage',
    'untitledBook',
  ].map((key) => `${NOTIFICATIONS}.${key}`),
}
