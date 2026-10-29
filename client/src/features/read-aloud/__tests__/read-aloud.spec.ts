// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { READ_ALOUD_ERROR_CODES, READ_ALOUD_JOB_STAGES } from '@bookorbit/types'
import { i18n } from '@/i18n'
import {
  eventText,
  jobErrorMessageKey,
  READ_ALOUD_I18N_KEYS,
  readAloudEntryNote,
  readAloudNotificationCopy,
  resolveReadAloudEntry,
  stageLabelKey,
  stepIndexOf,
} from '../lib/read-aloud'
import { makeCapability, makeJob } from './fixtures'

const te = (key: string) => i18n.global.te(key, 'en')

describe('read-aloud copy', () => {
  it('has an English message for every key the feature looks up by value', () => {
    const missing = Object.values(READ_ALOUD_I18N_KEYS)
      .flat()
      .filter((key) => !te(key))
    expect(missing).toEqual([])
  })

  it('maps every error code and stage in the contract to its own message', () => {
    for (const code of READ_ALOUD_ERROR_CODES) expect(jobErrorMessageKey(code, te)).toBe(`book.detail.files.readAloud.errors.job.${code}`)
    for (const stage of READ_ALOUD_JOB_STAGES) expect(stageLabelKey(stage)).toBe(`book.detail.files.readAloud.stages.${stage}`)
    expect(jobErrorMessageKey('ENOENT', te)).toBe('book.detail.files.readAloud.errors.job.unknown')
  })

  it('places every worker stage on the stepper', () => {
    for (const stage of [
      'preparing_audio',
      'downloading_model',
      'generating_emissions',
      'marking_up_ebook',
      'aligning',
      'validating',
      'publishing',
    ]) {
      expect(stepIndexOf(stage)).toBeGreaterThanOrEqual(0)
    }
    expect(stepIndexOf('downloading_model')).toBe(stepIndexOf('generating_emissions'))
  })
})

describe('resolveReadAloudEntry', () => {
  const base = { enabled: true, loadFailed: false, job: null }

  it('stays hidden without permission, before the first answer, and without a worker', () => {
    expect(resolveReadAloudEntry({ ...base, enabled: false, capability: makeCapability() }).kind).toBe('hidden')
    expect(resolveReadAloudEntry({ ...base, capability: null }).kind).toBe('hidden')
    expect(resolveReadAloudEntry({ ...base, capability: makeCapability({ workerConfigured: false }) }).kind).toBe('hidden')
  })

  it('hides for reasons only an admin can change', () => {
    for (const reason of ['worker_not_configured', 'single_file_library', 'no_audiobook'] as const) {
      expect(resolveReadAloudEntry({ ...base, capability: makeCapability({ eligible: false, reason }) }).kind).toBe('hidden')
    }
  })

  it('shows a reason for states the user can wait out or fix', () => {
    expect(resolveReadAloudEntry({ ...base, capability: makeCapability({ eligible: false, reason: 'worker_unavailable' }) })).toEqual({
      kind: 'unavailable',
      reason: 'worker_unavailable',
      reasonKey: 'book.detail.files.readAloud.reasons.worker_unavailable',
    })
  })

  it('explains an audiobook split into more files than a job takes', () => {
    const entry = resolveReadAloudEntry({ ...base, capability: makeCapability({ eligible: false, reason: 'too_many_audio_files' }) })
    expect(entry).toEqual({
      kind: 'unavailable',
      reason: 'too_many_audio_files',
      reasonKey: 'book.detail.files.readAloud.reasons.too_many_audio_files',
    })
    expect(te('book.detail.files.readAloud.reasons.too_many_audio_files')).toBe(true)
  })

  it('explains a book whose only EPUB is already a read-along', () => {
    const capability = makeCapability({
      eligible: false,
      reason: 'no_epub',
      existingReadAlongs: [{ fileId: 300, filename: 'a.epub', sizeBytes: 1, generatedByJobId: null }],
    })
    expect(resolveReadAloudEntry({ ...base, capability })).toMatchObject({ reasonKey: 'book.detail.files.readAloud.reasons.no_epub_existing' })
  })

  it('treats a live job as blocking even before the capability catches up', () => {
    const entry = resolveReadAloudEntry({ ...base, capability: makeCapability(), job: makeJob({ status: 'queued' }) })
    expect(entry).toMatchObject({ kind: 'unavailable', reason: 'job_active' })
  })

  it('reports a failed first check', () => {
    expect(resolveReadAloudEntry({ ...base, capability: null, loadFailed: true }).kind).toBe('loadFailed')
  })
})

describe('readAloudEntryNote', () => {
  const t = (key: string, values?: Record<string, unknown>) => i18n.global.t(key, values ?? {}, { locale: 'en' })
  const failed = { kind: 'loadFailed' } as const

  it('words each repeated failed check differently, so a retry never looks like nothing happened', () => {
    const first = readAloudEntryNote(failed, { failedChecks: 1, jobCardShown: false }, t)
    const second = readAloudEntryNote(failed, { failedChecks: 2, jobCardShown: false }, t)
    const third = readAloudEntryNote(failed, { failedChecks: 3, jobCardShown: false }, t)

    expect(first).toBe(t('book.detail.files.readAloud.loadFailed'))
    expect(second).toBe(t('book.detail.files.readAloud.loadFailedAgain', { count: 1 }))
    expect(third).toBe(t('book.detail.files.readAloud.loadFailedAgain', { count: 2 }))
    expect(new Set([first, second, third]).size).toBe(3)
  })

  it('leaves a running job to its card, and explains any other reason', () => {
    const running = resolveReadAloudEntry({ enabled: true, loadFailed: false, capability: makeCapability(), job: makeJob({ status: 'queued' }) })
    expect(readAloudEntryNote(running, { failedChecks: 0, jobCardShown: true }, t)).toBeNull()
    expect(readAloudEntryNote(running, { failedChecks: 0, jobCardShown: false }, t)).toBe(t('book.detail.files.readAloud.reasons.job_active'))
    expect(readAloudEntryNote({ kind: 'available' }, { failedChecks: 0, jobCardShown: false }, t)).toBeNull()
  })
})

describe('eventText', () => {
  const t = (key: string, values?: Record<string, unknown>) => i18n.global.t(key, values ?? {}, { locale: 'en' })
  const event = (overrides: Record<string, unknown>) =>
    ({ id: 1, at: '2026-10-01T00:00:00Z', level: 'info', stage: null, code: 'job_created', message: null, data: null, ...overrides }) as never

  it('reads known codes from the catalog, never from the English server message', () => {
    expect(eventText(event({ code: 'published', message: 'Added the read-along to the book' }), t, te)).toEqual({
      text: t('book.detail.files.readAloud.log.events.published'),
      detail: null,
    })
    const finished = eventText(event({ code: 'stage_finished', data: { durationMs: 2_500 } }), t, te)
    expect(finished.text).toContain('2.5')
    expect(eventText(event({ code: 'stage_finished' }), t, te).text).toBe(t('book.detail.files.readAloud.log.events.stage_finished_plain'))
  })

  it('explains a replacement the publisher was no longer allowed to make', () => {
    expect(READ_ALOUD_I18N_KEYS.events).toContain('book.detail.files.readAloud.log.events.replace_not_permitted')
    expect(eventText(event({ code: 'replace_not_permitted', level: 'warn', message: 'publisher lacks delete' }), t, te)).toEqual({
      text: t('book.detail.files.readAloud.log.events.replace_not_permitted'),
      detail: 'publisher lacks delete',
    })
  })

  it('keeps the raw message as a detail for problems and unknown codes', () => {
    expect(eventText(event({ code: 'inference_failed', level: 'error', message: 'onnx exploded' }), t, te)).toEqual({
      text: t('book.detail.files.readAloud.errors.job.inference_failed'),
      detail: 'onnx exploded',
    })
    expect(eventText(event({ code: 'something_new', message: 'raw' }), t, te)).toEqual({
      text: t('book.detail.files.readAloud.log.other'),
      detail: 'raw',
    })
  })
})

describe('readAloudNotificationCopy', () => {
  const t = (key: string, values?: Record<string, unknown>) => i18n.global.t(key, values ?? {}, { locale: 'en' })
  const stored = (type: string, meta: Record<string, unknown> | null) => ({ type, meta })

  it.each([
    ['read_aloud_ready', 'Read-aloud ready: Dune', null],
    ['read_aloud_needs_review', 'Read-aloud needs review: Dune', t('notifications.readAloud.needsReviewMessage')],
    ['read_aloud_review_expiring', 'Read-aloud review expires soon: Dune', t('notifications.readAloud.reviewExpiringMessage')],
  ])('phrases %s from the stored book title', (type, title, message) => {
    expect(readAloudNotificationCopy(stored(type, { bookTitle: 'Dune', errorCode: null }), t, te)).toEqual({ title, message })
  })

  it('explains a failure with the localized message for its error code', () => {
    expect(readAloudNotificationCopy(stored('read_aloud_failed', { bookTitle: 'Dune', errorCode: 'insufficient_storage' }), t, te)).toEqual({
      title: 'Read-aloud failed: Dune',
      message: t('book.detail.files.readAloud.errors.job.insufficient_storage'),
    })
  })

  it.each([null, 'ENOSPC', 42])('reads an error code it does not know (%j) as an unknown failure, never as a raw key', (errorCode) => {
    expect(readAloudNotificationCopy(stored('read_aloud_failed', { bookTitle: 'Dune', errorCode }), t, te)?.message).toBe(
      t('book.detail.files.readAloud.errors.job.unknown'),
    )
  })

  it.each([null, '', '   '])('names a book without a title (%j) in the reader’s language', (bookTitle) => {
    expect(readAloudNotificationCopy(stored('read_aloud_ready', { bookTitle }), t, te)?.title).toBe('Read-aloud ready: Untitled book')
  })

  it('keeps a title that looks like message syntax as plain text', () => {
    expect(readAloudNotificationCopy(stored('read_aloud_ready', { bookTitle: '{title} @:x | y' }), t, te)?.title).toBe(
      'Read-aloud ready: {title} @:x | y',
    )
  })

  it.each([
    ['a notification stored before the title was sent', stored('read_aloud_ready', { jobId: 'x', bookId: 12, errorCode: null })],
    ['a notification without meta', stored('read_aloud_ready', null)],
    ['another type', stored('book_request_submitted', { bookTitle: 'Dune' })],
  ])('leaves %s to the server’s own copy', (_label, notification) => {
    expect(readAloudNotificationCopy(notification, t, te)).toBeNull()
  })
})
