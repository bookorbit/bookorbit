import { describe, expect, it } from 'vitest'
import type { JobListItem } from '@bookorbit/types'

import {
  jobActionLabel,
  jobDayLabel,
  jobNoteText,
  jobOutcomeText,
  jobPhaseText,
  jobPlaceText,
  jobReasonText,
  jobStatusLabel,
  jobSubjectLabel,
  jobTypeLabel,
} from './job-copy'
import { jobMoment, jobProgress, jobQueueBand, jobTypeIcon, localDayKey } from './job-presentation'

type CopyFields = Pick<JobListItem, 'type' | 'shape' | 'kind' | 'status' | 'reason' | 'phase' | 'position' | 'done' | 'total' | 'extra' | 'subject'>

function job(fields: Partial<CopyFields> & Pick<JobListItem, 'type' | 'status'>): CopyFields {
  return {
    shape: 'job',
    kind: null,
    reason: null,
    phase: null,
    position: null,
    done: null,
    total: null,
    extra: null,
    subject: { label: null, byline: null, url: null, image: null },
    ...fields,
  }
}

describe('job copy', () => {
  it('names a known type and falls back for one this version does not know', () => {
    expect(jobTypeLabel('story-guide')).toBe('Story guide')
    expect(jobTypeLabel('time-machine')).toBe('Job')
  })

  it("gives a queued job's place in its own type's lane, or generic wording for an unknown type", () => {
    expect(jobPlaceText(job({ type: 'story-guide', status: 'queued', position: 1 }))).toBe('Next in story guides')
    expect(jobPlaceText(job({ type: 'story-guide', status: 'queued', position: 12 }))).toBe('#12 in story guides')
    expect(jobPlaceText(job({ type: 'time-machine' as JobListItem['type'], status: 'queued', position: 3 }))).toBe('Place 3 in the queue')
    expect(jobPlaceText(job({ type: 'story-guide', status: 'running', position: 1 }))).toBeNull()
  })

  it('words read-aloud jobs the way the book page does', () => {
    expect(jobTypeLabel('read-along')).toBe('Read-aloud')
    expect(jobPlaceText(job({ type: 'read-along', status: 'queued', position: 2 }))).toBe('#2 in read-alouds')
    expect(jobPhaseText(job({ type: 'read-along', status: 'running', phase: 'aligning', done: null, total: null }))).toBe(
      'Matching the text to the narration',
    )
    expect(jobReasonText(job({ type: 'read-along', status: 'paused', reason: 'user' }))).toBe('Paused until someone resumes it.')
    expect(jobReasonText(job({ type: 'read-along', status: 'needs-you', reason: 'review' }))).toBe('Ready for review on the book page.')
    expect(jobReasonText(job({ type: 'read-along', status: 'needs-you', reason: 'review', extra: { expiresAt: '2026-11-29T12:00:00.000Z' } }))).toBe(
      'Ready for review on the book page until Nov 29.',
    )
    expect(jobReasonText(job({ type: 'read-along', status: 'failed', reason: 'insufficient_storage' }))).toBe(
      "There isn't enough free disk space to finish.",
    )
    expect(jobReasonText(job({ type: 'read-along', status: 'failed', reason: 'from-a-newer-server' }))).toBe(
      'Something went wrong while creating the read-aloud.',
    )
    expect(jobOutcomeText(job({ type: 'read-along', status: 'completed', reason: 'warnings' }))).toBe('Read-aloud added, with warnings.')
    expect(jobOutcomeText(job({ type: 'read-along', status: 'cancelled', reason: 'review_expired' }))).toBe("It wasn't reviewed within 14 days.")
    expect(jobOutcomeText(job({ type: 'read-along', status: 'cancelled', reason: 'cancelled' }))).toBe('Cancelled')
  })

  it('words merges, chapter changes, duplicate scans and downloads in their own terms', () => {
    expect(jobPhaseText(job({ type: 'book-merge', status: 'running', phase: 'moving' }))).toBe('Moving files')
    expect(jobReasonText(job({ type: 'book-merge', status: 'failed', reason: 'FILE_CHANGED' }))).toBe('A file changed on disk while the merge ran.')
    expect(jobReasonText(job({ type: 'book-merge', status: 'failed', reason: 'rolled-back' }))).toBe('Undone, nothing was changed.')
    expect(jobPhaseText(job({ type: 'chapter-edit', status: 'running', kind: 'write' }))).toBe('Writing chapters into the files')
    expect(jobOutcomeText(job({ type: 'chapter-edit', status: 'completed', kind: 'revert' }))).toBe('Chapters reverted to the files.')
    expect(jobReasonText(job({ type: 'chapter-edit', status: 'failed', reason: 'CHAPTERS_WRITE_UNAVAILABLE' }))).toBe(
      "Chapters can't be written into these files.",
    )
    expect(jobReasonText(job({ type: 'chapter-edit', status: 'failed', reason: 'FROM_A_NEWER_SERVER' }))).toBe('Something went wrong on the server.')
    expect(jobPhaseText(job({ type: 'duplicate-scan', status: 'running', kind: 'library' }))).toBe('Looking for duplicates')
    expect(jobReasonText(job({ type: 'duplicate-scan', status: 'failed', reason: 'scan_interrupted' }))).toBe('The server restarted during the scan.')
    expect(jobReasonText(job({ type: 'request-download', status: 'needs-you', reason: 'review' }))).toBe(
      'Downloaded. Review it before it is imported.',
    )
    expect(jobReasonText(job({ type: 'request-download', status: 'failed' }))).toBe('The download did not finish.')
    expect(jobOutcomeText(job({ type: 'request-download', status: 'cancelled', reason: 'removed' }))).toBe('Removed before it finished.')
    expect(jobNoteText('chapter-edit-requester')).toBe('Only the person who started it can try it again.')
  })

  it('names a summary row after its queue and counts what it stands for', () => {
    const lookups = { type: 'chapter-lookup' as const, shape: 'queue' as const }
    expect(jobSubjectLabel(job({ ...lookups, status: 'running' }))).toBe('Chapter lookups')
    expect(jobPhaseText(job({ ...lookups, status: 'running', total: 12 }))).toBe('12 books left')
    expect(jobPlaceText(job({ ...lookups, status: 'queued', total: 1 }))).toBe('1 book left')
    expect(jobReasonText(job({ ...lookups, status: 'needs-you', reason: 'review', extra: { review: 3 } }))).toBe('3 books to review')
    expect(jobReasonText(job({ ...lookups, status: 'failed', reason: 'failed', extra: { failed: 2 } }))).toBe('2 books failed')
    expect(jobPhaseText(job({ type: 'bulk-run', shape: 'queue', status: 'running', done: 4, total: 10 }))).toBe('6 left')
    expect(jobSubjectLabel(job({ type: 'book-merge', status: 'completed' }))).toBe('Something you can no longer open')
  })

  it('words library scans and the metadata queues', () => {
    expect(jobPhaseText(job({ type: 'library-scan', status: 'running', kind: 'watcher' }))).toBe('Scanning files')
    expect(jobOutcomeText(job({ type: 'library-scan', status: 'completed', kind: 'watcher' }))).toBe('Changes picked up.')
    expect(jobReasonText(job({ type: 'library-scan', status: 'failed', reason: 'error' }))).toBe('The scan stopped on an error.')
    const fetch = { type: 'metadata-fetch' as const, shape: 'queue' as const }
    expect(jobSubjectLabel(job({ ...fetch, status: 'running' }))).toBe('Metadata auto-fetch')
    expect(jobPhaseText(job({ ...fetch, status: 'running', done: 30, total: 40 }))).toBe('10 books left')
    expect(jobReasonText(job({ ...fetch, status: 'paused' }))).toBe('Paused until someone resumes it.')
    const authors = { type: 'author-enrichment' as const, shape: 'queue' as const }
    expect(jobPlaceText(job({ ...authors, status: 'queued', reason: 'rate-limited', total: 5 }))).toBe(
      "Waiting for the provider's rate limit to reset.",
    )
    expect(jobPlaceText(job({ ...authors, status: 'queued', total: 5 }))).toBe('5 authors left')
    expect(jobReasonText(job({ ...authors, status: 'failed', reason: 'failed', extra: { failed: 1 } }))).toBe('1 author failed')
    expect(jobNoteText('metadata-config')).toBe('Only people who manage metadata settings can change it.')
  })

  it('names a bulk action by its kind and words how far it got', () => {
    const run = { type: 'bulk-run' as const, kind: 'book-refresh-metadata' }
    expect(jobTypeLabel('bulk-run')).toBe('Bulk action')
    expect(jobSubjectLabel(job({ ...run, status: 'running' }))).toBe('Refresh book metadata')
    expect(jobSubjectLabel(job({ ...run, kind: 'book-move', status: 'queued' }))).toBe('Move books')
    expect(jobSubjectLabel(job({ ...run, kind: 'from-a-newer-server', status: 'queued' }))).toBe('Bulk action')
    expect(jobPlaceText(job({ ...run, status: 'queued', position: 1 }))).toBe('Next in your bulk actions')
    expect(jobPlaceText(job({ ...run, status: 'queued', position: 3 }))).toBe('#3 in your bulk actions')
    expect(jobPhaseText(job({ ...run, status: 'running', done: 1200, total: 4000 }))).toBe('1,200 of 4,000')
    expect(jobPhaseText(job({ ...run, status: 'running', phase: 'cancelling', done: 12, total: 40 }))).toBe('Cancelling')
    expect(jobOutcomeText(job({ ...run, status: 'completed', done: 40, total: 40 }))).toBe('Finished.')
    expect(jobOutcomeText(job({ ...run, status: 'completed', done: 40, total: 40, extra: { failed: 3 } }))).toBe('Finished, 3 items failed.')
    expect(jobOutcomeText(job({ ...run, status: 'cancelled', done: 12, total: 40 }))).toBe('Cancelled after 12 of 40.')
  })

  it('says why a bulk action stopped, and when Continue can pick it up', () => {
    const run = { type: 'bulk-run' as const, kind: 'book-move', status: 'failed' as const }
    expect(jobReasonText(job({ ...run, reason: 'interrupted' }))).toBe('Stopped when the server restarted. Continue picks up where it left off.')
    expect(jobReasonText(job({ ...run, reason: 'credential-revoked' }))).toBe('Stopped: the API key that started it was revoked or has expired.')
    expect(jobReasonText(job({ ...run, reason: 'access-revoked' }))).toBe('Stopped: the account that started it can no longer do this.')
    expect(jobReasonText(job({ ...run, reason: 'requester-gone' }))).toBe('Stopped: the account that started it was removed.')
    expect(jobReasonText(job({ ...run, reason: 'unknown-kind' }))).toBe("This server can't run this kind of bulk action.")
    expect(jobReasonText(job({ ...run, reason: 'from-a-newer-server' }))).toBe('Stopped on an error.')
    expect(jobNoteText('bulk-run-continue-later')).toBe('This can continue once the server finishes checking its libraries.')
    expect(jobActionLabel('continue')).toBe('Continue')
    expect(jobTypeIcon('bulk-run')).not.toBe(jobTypeIcon('time-machine'))
  })

  it('spells out every status, including one only the Jobs area has', () => {
    expect(jobStatusLabel('needs-you')).toBe('Needs you')
    expect(jobStatusLabel('failed')).toBe('Failed')
  })

  it('heads History bands with today, yesterday or the date', () => {
    const now = new Date(2026, 10, 15, 12)
    expect(jobDayLabel('2026-11-15', now)).toBe('Today')
    expect(jobDayLabel('2026-11-14', now)).toBe('Yesterday')
    expect(jobDayLabel('2026-11-10', now)).toMatch(/Nov/)
  })
})

describe('job presentation', () => {
  it('puts running, next, later and paused jobs in their queue bands', () => {
    expect(jobQueueBand({ status: 'running', position: null })).toBe('running')
    expect(jobQueueBand({ status: 'queued', position: 1 })).toBe('next')
    expect(jobQueueBand({ status: 'queued', position: null })).toBe('next')
    expect(jobQueueBand({ status: 'queued', position: 2 })).toBe('later')
    expect(jobQueueBand({ status: 'paused', position: null })).toBe('paused')
  })

  it('measures progress from counts, else a percentage, and only while running', () => {
    expect(jobProgress({ status: 'running', done: 3, total: 4, percent: null })).toBe(0.75)
    expect(jobProgress({ status: 'running', done: null, total: null, percent: 40 })).toBe(0.4)
    expect(jobProgress({ status: 'running', done: 0, total: null, percent: null })).toBeNull()
    expect(jobProgress({ status: 'queued', done: 3, total: 4, percent: null })).toBeNull()
  })

  it('dates a row by what last happened to it', () => {
    const base = { createdAt: '2026-11-15T08:00:00Z', startedAt: '2026-11-15T09:00:00Z', pausedAt: null, finishedAt: '2026-11-15T10:00:00Z' }
    expect(jobMoment({ ...base, status: 'completed' })).toEqual({ kind: 'finished', at: base.finishedAt })
    expect(jobMoment({ ...base, status: 'running' })).toEqual({ kind: 'started', at: base.startedAt })
    expect(jobMoment({ ...base, status: 'queued' })).toEqual({ kind: 'queued', at: base.createdAt })
    expect(localDayKey(new Date(2026, 0, 5, 23, 30).toISOString())).toBe('2026-01-05')
  })
})
