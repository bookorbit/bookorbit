import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import type { ReadAloudJob } from '@bookorbit/types'
import { activateI18nLocale, i18n } from '@/i18n'
import { formatRelativeTimeFromNow } from '@/i18n/formatters'
import { JOB_ID, jsonResponse, makeChapter, makeJob, makeReport } from './fixtures'

const mocks = vi.hoisted(() => ({ api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>() }))
vi.mock('@/lib/api', () => ({ api: mocks.api }))

import ReadAloudJobCard from '../components/ReadAloudJobCard.vue'
import type { ReadAloudAction } from '../composables/useReadAloud'

const t = i18n.global.t
let wrapper: VueWrapper | null = null

beforeAll(() => {
  activateI18nLocale('en')
})

beforeEach(() => {
  mocks.api.mockReset()
  mocks.api.mockImplementation(async (input) => {
    const url = String(input)
    if (url.endsWith('/report')) return jsonResponse(makeReport([makeChapter()]))
    if (url.includes('/events')) return jsonResponse({ events: [] })
    throw new Error(`Unexpected request: ${url}`)
  })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

function mountCard(
  job: ReadAloudJob,
  extra: { action?: ReadAloudAction | null; errorKey?: string | null; canStartOver?: boolean; viewerId?: number | null } = {},
) {
  wrapper = mount(ReadAloudJobCard, {
    attachTo: document.body,
    props: {
      job,
      action: extra.action ?? null,
      errorKey: extra.errorKey ?? null,
      canStartOver: extra.canStartOver ?? true,
      viewerId: extra.viewerId === undefined ? 1 : extra.viewerId,
    },
  })
  return wrapper
}

function buttonTexts(card: VueWrapper): string[] {
  return card.findAll('button').map((button) => button.text().trim())
}

function findButton(card: VueWrapper, text: string) {
  return card.findAll('button').find((button) => button.text().trim() === text)
}

const CANCEL = () => t('book.detail.files.readAloud.job.cancel')
const RETRY = () => t('book.detail.files.readAloud.job.retry')
const START_OVER = () => t('book.detail.files.readAloud.job.startOver')
const DISMISS = () => t('book.detail.files.readAloud.job.dismiss')
const PUBLISH = () => t('book.detail.files.readAloud.review.publishAnyway')

describe('ReadAloudJobCard', () => {
  it('shows a queued job with its place in line and a cancel control', () => {
    const card = mountCard(makeJob({ status: 'queued', queuePosition: 2 }))

    expect(card.text()).toContain(t('book.detail.files.readAloud.job.queuedTitle'))
    expect(card.text()).toContain(t('book.detail.files.readAloud.job.queueAhead', { count: 2 }))
    expect(buttonTexts(card)).toContain(CANCEL())
    expect(card.find('button[aria-label="' + DISMISS() + '"]').exists()).toBe(false)
  })

  it('shows a running stage with its detail, a stepper and a localized percentage', () => {
    const card = mountCard(makeJob({ stage: 'generating_emissions', progress: 37, stageDetail: { current: 7, total: 24, unit: 'track' } }))

    expect(card.text()).toContain(t('book.detail.files.readAloud.stages.generating_emissions'))
    // Seven tracks are finished, so the eighth is the one in progress.
    expect(card.text()).toContain(t('book.detail.files.readAloud.stageDetail.track', { current: 8, total: 24 }))
    expect(card.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('37')
    const current = card.find('[aria-current="step"]')
    expect(current.text()).toContain(t('book.detail.files.readAloud.steps.speech'))
    expect(card.findAll('[role="alert"]')).toHaveLength(0)
  })

  it('renders each part of a running description on its own, with a decorative separator', () => {
    const startedAt = new Date(Date.now() - 2 * 3_600_000).toISOString()
    const card = mountCard(makeJob({ stage: 'downloading_model', startedAt, stageDetail: { current: 0, total: 3, unit: 'file' } }))

    const description = card.get('[data-test="read-aloud-description"]')
    expect(description.findAll('span:not([aria-hidden])').map((part) => part.text())).toEqual([
      t('book.detail.files.readAloud.stageDetail.file', { current: 1, total: 3 }),
      t('book.detail.files.readAloud.job.firstRunForLanguage'),
      t('book.detail.files.readAloud.job.elapsed', { duration: t('book.detail.files.duration.hoursMinutes', { hours: 2, minutes: 0 }) }),
    ])
    expect(description.findAll('[aria-hidden="true"]').map((separator) => separator.text())).toEqual(['·', '·'])
  })

  it.each([
    ['running', makeJob()],
    ['failed', makeJob({ status: 'failed', errorCode: 'inference_failed' })],
    ['complete', makeJob({ status: 'completed' })],
  ])('names the activity section with a heading that exists while %s', async (_state, job) => {
    const card = mountCard(job)
    await findButton(card, t('book.detail.files.readAloud.job.details'))!.trigger('click')
    await flushPromises()

    const section = card.get('section[aria-labelledby$="-activity"]')
    const heading = card.find(`[id="${section.attributes('aria-labelledby')}"]`)
    expect(heading.exists()).toBe(true)
    expect(heading.text()).toBe(t('book.detail.files.readAloud.job.activityHeading'))
  })

  it('asks before cancelling, inline, and keeps the keyboard on the safe answer', async () => {
    const card = mountCard(makeJob())

    await findButton(card, CANCEL())!.trigger('click')
    await nextTick()

    const group = card.find('[role="group"]')
    expect(group.text()).toContain(t('book.detail.files.readAloud.job.cancelPrompt'))
    expect(document.activeElement?.textContent?.trim()).toBe(t('book.detail.files.readAloud.job.keepRunning'))
    expect(card.emitted('cancel')).toBeUndefined()

    await group
      .findAll('button')
      .find((button) => button.text().trim() === CANCEL())!
      .trigger('click')
    expect(card.emitted('cancel')).toHaveLength(1)
  })

  it.each([
    ['queued', makeJob({ status: 'queued', queuePosition: 0, cancellable: false })],
    ['processing', makeJob({ cancellable: false })],
  ])('offers no cancel for a %s job the server would refuse to cancel', (_state, job) => {
    const card = mountCard(job)

    expect(buttonTexts(card)).not.toContain(CANCEL())
    expect(card.find('[role="group"]').exists()).toBe(false)
  })

  it('shows a neutral stopping state, without an error, while cancellation is pending', () => {
    const card = mountCard(makeJob({ cancelRequested: true, errorCode: 'cancelled' }))

    expect(card.text()).toContain(t('book.detail.files.readAloud.job.stoppingTitle'))
    expect(card.findAll('[role="alert"]')).toHaveLength(0)
    expect(buttonTexts(card)).not.toContain(CANCEL())
  })

  it('hides every mutation from someone who cannot manage the job and says who started it', async () => {
    const card = mountCard(makeJob({ status: 'awaiting_review', canManage: false, requestedBy: { id: 7, name: 'Sam' } }))
    await flushPromises()

    expect(card.text()).toContain(t('book.detail.files.readAloud.job.startedBy', { name: 'Sam' }))
    const texts = buttonTexts(card)
    expect(texts).not.toContain(PUBLISH())
    expect(texts).not.toContain(t('book.detail.files.readAloud.review.discard'))
    expect(texts).not.toContain(CANCEL())
    expect(card.findAll('input[type="checkbox"]')).toHaveLength(0)
  })

  it('offers publish, re-sync and discard for a job awaiting review', async () => {
    const expiresAt = Date.now() + 2 * 86_400_000
    const card = mountCard(makeJob({ status: 'awaiting_review', expiresAt: new Date(expiresAt).toISOString() }))
    await flushPromises()

    const texts = buttonTexts(card)
    expect(texts).toContain(PUBLISH())
    expect(texts).toContain(t('book.detail.files.readAloud.review.resync'))
    expect(texts).toContain(t('book.detail.files.readAloud.review.discard'))
    expect(mocks.api).toHaveBeenCalledWith(`/api/v1/read-aloud-jobs/${JOB_ID}/report`, expect.any(Object))
    const when = formatRelativeTimeFromNow(expiresAt, { smallestUnit: 'minute' })
    expect(card.text()).toContain(t('book.detail.files.readAloud.job.reviewExpires', { when }))

    await findButton(card, PUBLISH())!.trigger('click')
    expect(card.emitted('publish')).toHaveLength(1)
  })

  it('opens and shows the read-along when it is ready, and can be dismissed', async () => {
    const card = mountCard(makeJob({ status: 'completed_with_warnings', warnings: ['unmatched_text'] }))

    expect(card.text()).toContain(t('book.detail.files.readAloud.job.completeWarningsTitle'))
    expect(card.text()).toContain(t('book.detail.files.readAloud.warnings.unmatched_text'))

    await findButton(card, t('book.detail.files.readAloud.job.openReadAlong'))!.trigger('click')
    await findButton(card, t('book.detail.files.readAloud.job.showFile'))!.trigger('click')
    await card.find(`button[aria-label="${DISMISS()}"]`).trigger('click')

    expect(card.emitted('openOutput')).toEqual([[105]])
    expect(card.emitted('showOutput')).toEqual([[105]])
    expect(card.emitted('dismiss')).toHaveLength(1)
  })

  describe('a finished job says how much matched and what the narration never covers', () => {
    const REPORT = {
      sentences: 8094,
      matchedSentences: 7396,
      interpolatedSentences: 60,
      unmatchedSentences: 638,
      droppedSentences: 0,
      seconds: 29434,
      matchedSeconds: 29230,
      interpolatedSeconds: 119,
      looseSeconds: 27,
      tracks: 37,
      unalignedTracks: 0,
    }
    const COVERAGE = {
      storySentences: 7456,
      storyUnmatchedSentences: 0,
      outsideSentences: 638,
      outsideChapterCount: 10,
      outsideTitles: ['Copyright', 'Table of Contents', 'Dedication', 'Acknowledgments', 'Contact', 'Sample', 'About', 'Also by'],
    }

    it('shows the story numbers, the audio used, and the chapters outside the narration', () => {
      const card = mountCard(makeJob({ status: 'completed', report: REPORT, coverage: COVERAGE }))
      const coverage = card.get('[data-test="read-aloud-coverage"]')
      expect(coverage.findAll('span:not([aria-hidden])').map((part) => part.text())).toEqual([
        '7,456 of 7,456 sentences matched the narration',
        '100% of the audio used',
      ])
      expect(coverage.findAll('[aria-hidden="true"]')).toHaveLength(1)
      expect(card.text()).toContain(
        'Not in the narration, so left without audio: Copyright, Table of Contents, Dedication, Acknowledgments, Contact, Sample, About, Also by, and 2 more chapters.',
      )
    })

    it('falls back to the whole book for a job finished before coverage was recorded', () => {
      const card = mountCard(makeJob({ status: 'completed_with_warnings', report: REPORT, warnings: ['unmatched_text'] }))
      expect(card.text()).toContain('7,456 of 8,094 sentences matched the narration')
      expect(card.text()).not.toContain('Not in the narration')
    })

    it('shows the chapter table under Details, read-only, with chapters outside the narration labelled rather than flagged', async () => {
      mocks.api.mockImplementation(async (input) => {
        const url = String(input)
        if (url.endsWith('/report')) {
          return jsonResponse(
            makeReport([
              makeChapter({
                index: 0,
                href: 'copyright.xhtml',
                title: 'Copyright',
                zone: 'front',
                status: 'not-found',
                matchedSentenceCount: 0,
                outsideNarration: true,
              }),
              makeChapter({ index: 1, href: 'one.xhtml', title: 'Chapter One', zone: 'body', status: 'aligned' }),
            ]),
          )
        }
        if (url.includes('/events')) return jsonResponse({ events: [] })
        throw new Error(`Unexpected request: ${url}`)
      })
      const card = mountCard(makeJob({ status: 'completed', report: REPORT, coverage: COVERAGE }))
      expect(mocks.api).not.toHaveBeenCalledWith(expect.stringContaining('/report'), expect.anything())

      await findButton(card, t('book.detail.files.readAloud.job.details'))!.trigger('click')
      await flushPromises()

      const text = card.text()
      expect(text).toContain(t('book.detail.files.readAloud.job.chaptersHeading'))
      expect(text).toContain('Not in the narration')
      expect(text).toContain(t('book.detail.files.readAloud.review.summary', { count: 2, attention: 0 }))
      expect(card.findAll('input[type="checkbox"]')).toHaveLength(0)
      expect(findButton(card, PUBLISH())).toBeUndefined()
    })

    it('says so when a finished job kept no chapter report', async () => {
      mocks.api.mockImplementation(async (input) => {
        const url = String(input)
        if (url.endsWith('/report')) return jsonResponse(makeReport([]))
        if (url.includes('/events')) return jsonResponse({ events: [] })
        throw new Error(`Unexpected request: ${url}`)
      })
      const card = mountCard(makeJob({ status: 'completed', report: REPORT }))
      await findButton(card, t('book.detail.files.readAloud.job.details'))!.trigger('click')
      await flushPromises()
      expect(card.text()).toContain(t('book.detail.files.readAloud.review.noReport'))
    })
  })

  it('offers Retry only while the failed job keeps its work, and Start over when a job can start', async () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString()
    const card = mountCard(makeJob({ status: 'failed', errorCode: 'inference_failed', retryableUntil: future }))

    expect(card.text()).toContain(t('book.detail.files.readAloud.errors.job.inference_failed'))
    expect(buttonTexts(card)).toEqual(expect.arrayContaining([RETRY(), START_OVER()]))
    await findButton(card, RETRY())!.trigger('click')
    await findButton(card, START_OVER())!.trigger('click')
    expect(card.emitted('retry')).toHaveLength(1)
    expect(card.emitted('startOver')).toHaveLength(1)

    await card.setProps({
      job: makeJob({ status: 'failed', errorCode: 'inference_failed', retryableUntil: '2020-01-01T00:00:00.000Z' }),
      canStartOver: false,
    })
    expect(buttonTexts(card)).not.toContain(RETRY())
    expect(buttonTexts(card)).not.toContain(START_OVER())
  })

  it('reads an unknown error code as the generic failure, never as a raw key', () => {
    const card = mountCard(makeJob({ status: 'failed', errorCode: 'brand_new_code' as never }))

    expect(card.text()).toContain(t('book.detail.files.readAloud.errors.job.unknown'))
    expect(card.text()).not.toContain('brand_new_code')
  })

  it('calls a discarded review "discarded", not "cancelled"', () => {
    const report = makeReport([]).totals
    const card = mountCard(makeJob({ status: 'cancelled', errorCode: 'discarded', report }))

    expect(card.text()).toContain(t('book.detail.files.readAloud.job.discardedTitle'))
    expect(card.text()).not.toContain(t('book.detail.files.readAloud.job.cancelledTitle'))
    expect(card.text()).not.toContain(t('book.detail.files.readAloud.errors.job.cancelled'))
  })

  it('calls a re-sync cancelled mid-run "cancelled" even though it carries an earlier report', () => {
    const report = makeReport([]).totals
    const card = mountCard(makeJob({ status: 'cancelled', errorCode: 'cancelled', report }))

    expect(card.text()).toContain(t('book.detail.files.readAloud.job.cancelledTitle'))
  })

  it('announces stage changes but not percentage ticks', async () => {
    const card = mountCard(makeJob({ stage: 'generating_emissions', progress: 10 }))
    const live = () => card.find('[aria-live="polite"]').text()
    const before = live()

    await card.setProps({ job: makeJob({ stage: 'generating_emissions', progress: 11, updatedAt: '2026-01-01T00:01:00.000Z' }) })
    expect(live()).toBe(before)

    await card.setProps({ job: makeJob({ stage: 'aligning', progress: 80, updatedAt: '2026-01-01T00:02:00.000Z' }) })
    expect(live()).toBe(t('book.detail.files.readAloud.job.live', { status: t('book.detail.files.readAloud.stages.aligning') }))
  })

  it('reads the activity log once Details opens', async () => {
    mocks.api.mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/events')) {
        return jsonResponse({
          events: [{ id: 4, at: '2026-01-01T00:00:00.000Z', level: 'warn', stage: 'aligning', code: 'slow', message: 'Slow chapter', data: null }],
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    const card = mountCard(makeJob())
    expect(mocks.api).not.toHaveBeenCalled()

    await findButton(card, t('book.detail.files.readAloud.job.details'))!.trigger('click')
    await flushPromises()

    expect(mocks.api).toHaveBeenCalledWith(`/api/v1/read-aloud-jobs/${JOB_ID}/events`)
    expect(card.text()).toContain('Slow chapter')
    expect(card.text()).toContain(t('book.detail.files.readAloud.log.warn'))
  })

  it('shows a failed action once', () => {
    const card = mountCard(makeJob(), { errorKey: 'book.detail.files.readAloud.errors.cancel' })

    const alerts = card.findAll('[role="alert"]')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.text()).toBe(t('book.detail.files.readAloud.errors.cancel'))
  })
})
