import { toast } from 'vue-sonner'
import { BULK_RUN_ID_HEADER, BULK_RUN_MAX_UNFINISHED, type BulkRunKind, type JobActionOutcome, type JobView } from '@bookorbit/types'

import { i18n } from '@/i18n'
import { actOnJobs } from '../api/jobs.api'
import { jobsFilterQuery } from './jobs-filter'

const { t } = i18n.global

/** Where a bulk run is in the Jobs area: its action id. */
export function bulkRunJobId(runId: string): string {
  return `bulk-run:${runId}`
}

/** The run a bulk route's stream follows; null for an empty selection, which the server answers at once. */
export function bulkRunIdOf(response: Response): string | null {
  // Test doubles and older servers may answer without headers at all.
  const headers = (response as Partial<Response>).headers
  const id = headers?.get(BULK_RUN_ID_HEADER) ?? null
  return id && id.trim().length > 0 ? id.trim() : null
}

export class BulkRunCancelError extends Error {
  constructor(readonly outcome: JobActionOutcome) {
    super(`Bulk run cancel answered ${outcome}`)
    this.name = 'BulkRunCancelError'
  }
}

/** Asks the server to stop a run before its next item. One that already ended, or is already stopping, counts as stopped. */
export async function cancelBulkRun(runId: string): Promise<void> {
  const { results } = await actOnJobs({ action: 'cancel', ids: [bulkRunJobId(runId)] })
  const outcome = results[0]?.outcome ?? 'error'
  if (outcome !== 'done' && outcome !== 'skipped') throw new BulkRunCancelError(outcome)
}

/** The name a run in progress goes by; two kinds reuse the wording their screens already had. */
const LABEL_KEYS: Record<BulkRunKind, string> = {
  'book-refresh-metadata': 'jobsArea.bulk.labels.book-refresh-metadata',
  'book-re-extract-cover': 'book.coverRegeneration.bulkInProgress',
  'book-embed-audio-cover': 'book.audioCoverEmbed.bulkInProgress',
  'author-refresh-metadata': 'jobsArea.bulk.labels.author-refresh-metadata',
  'book-move': 'jobsArea.bulk.labels.book-move',
}

export function bulkRunLabel(kind: BulkRunKind): string {
  return t(LABEL_KEYS[kind])
}

/** Why a bulk route refused before its stream: the account's line is full, or the kind's own failure wording. */
export function bulkRunRefusalText(response: Pick<Response, 'status'> | null, fallback: string): string {
  return response?.status === 429 ? t('jobsArea.bulk.tooMany', { count: BULK_RUN_MAX_UNFINISHED }) : fallback
}

/**
 * Opens the Jobs area on bulk actions, in the queue or, for one that stopped, in Failed. The router
 * loads on demand, so code that only follows a stream never pulls it in.
 */
export function openJobs(view: Extract<JobView, 'queue' | 'failed'> = 'queue'): void {
  const query = jobsFilterQuery({ view, type: 'bulk-run' })
  void import('@/router').then(({ default: router }) => router.push({ name: 'jobs-activity', query }))
}

function openJobsQueue(): void {
  openJobs('queue')
}

function openJobsFailed(): void {
  openJobs('failed')
}

/** A toast about a bulk run that offers to open Jobs, where the run can be followed and cancelled. */
export function toastWithJobsLink(tone: 'info' | 'error', key: string): void {
  toast[tone](t(key), { action: { label: t('jobsArea.bulk.openJobs'), onClick: tone === 'error' ? openJobsFailed : openJobsQueue } })
}
