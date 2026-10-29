import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { ReadAloudDecisions, ReadAloudJob } from '@bookorbit/types'
import { activateI18nLocale, i18n } from '@/i18n'
import { jsonResponse, makeChapter, makeJob, makeReport } from './fixtures'

const mocks = vi.hoisted(() => ({ api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>() }))
vi.mock('@/lib/api', () => ({ api: mocks.api }))

import ReadAloudReview from '../components/ReadAloudReview.vue'

const t = i18n.global.t
let wrapper: VueWrapper | null = null

const CHAPTERS = [
  makeChapter({ index: 0, href: 'front.xhtml', title: 'Title page', zone: 'front', status: 'excluded', sentenceCount: 4, matchedSentenceCount: 0 }),
  makeChapter({ index: 1, href: 'chapter-1.xhtml', title: 'One', zone: 'body', status: 'aligned' }),
  makeChapter({ index: 2, href: 'chapter-2.xhtml', title: 'Two', zone: 'body', status: 'not-found', matchedSentenceCount: 0 }),
  makeChapter({ index: 3, href: 'colophon.xhtml', title: null, preview: null, zone: 'back', status: 'aligned' }),
]

beforeAll(() => {
  activateI18nLocale('en')
})

beforeEach(() => {
  mocks.api.mockReset()
  mocks.api.mockImplementation(async () => jsonResponse(makeReport(CHAPTERS)))
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

async function mountReview(job: ReadAloudJob = makeJob({ status: 'awaiting_review' })) {
  wrapper = mount(ReadAloudReview, { props: { job, action: null } })
  await flushPromises()
  return wrapper
}

function includeBox(review: VueWrapper, title: string) {
  return review.find(`input[type="checkbox"][aria-label="${t('book.detail.files.readAloud.review.include', { title })}"]`)
}

function resyncButton(review: VueWrapper) {
  return review.findAll('button').find((button) => button.text().trim() === t('book.detail.files.readAloud.review.resync'))!
}

describe('ReadAloudReview', () => {
  it('lists every chapter with its status in text, and a control only where a decision is possible', async () => {
    const review = await mountReview()

    expect(review.findAll('li')).toHaveLength(4)
    expect(review.text()).toContain(t('book.detail.files.readAloud.review.status.notFound'))
    expect(review.text()).toContain('colophon.xhtml')
    expect(includeBox(review, 'Title page').exists()).toBe(true)
    expect(includeBox(review, 'One').exists()).toBe(true)
    expect(includeBox(review, 'Two').exists()).toBe(true)
    // Back matter that aligned cleanly needs no decision.
    expect(includeBox(review, 'colophon.xhtml').exists()).toBe(false)
    expect(review.text()).toContain(t('book.detail.files.readAloud.review.summary', { count: 4, attention: 1 }))
  })

  it('enables Re-sync only once a decision changes, and sends the job decisions with the changes on top', async () => {
    const job = makeJob({
      status: 'awaiting_review',
      decisions: { chapters: { 'chapter-9.xhtml': 'excluded' }, audio: [{ track: '0003.mp3', start: 0, end: 12 }] },
    })
    const review = await mountReview(job)
    expect(resyncButton(review).attributes('disabled')).toBeDefined()

    await includeBox(review, 'Two').setValue(false)
    await includeBox(review, 'Title page').setValue(true)
    expect(resyncButton(review).attributes('disabled')).toBeUndefined()
    expect(review.text()).toContain(t('book.detail.files.readAloud.review.pending', { count: 2 }))

    await resyncButton(review).trigger('click')

    const [[decisions]] = review.emitted('resync') as [[ReadAloudDecisions]]
    expect(decisions).toEqual({
      chapters: { 'chapter-9.xhtml': 'excluded', 'chapter-2.xhtml': 'excluded', 'front.xhtml': 'included' },
      audio: [{ track: '0003.mp3', start: 0, end: 12 }],
    })
  })

  it('labels chapters outside the narration instead of asking about them', async () => {
    mocks.api.mockImplementation(async () =>
      jsonResponse(
        makeReport([
          ...CHAPTERS,
          makeChapter({
            index: 4,
            href: 'sample.xhtml',
            title: 'Sample',
            zone: 'back',
            status: 'not-found',
            matchedSentenceCount: 0,
            outsideNarration: true,
          }),
        ]),
      ),
    )
    const review = await mountReview()
    expect(review.text()).toContain(t('book.detail.files.readAloud.review.summary', { count: 5, attention: 1 }))
    expect(review.text()).toContain(t('book.detail.files.readAloud.review.status.outside'))
  })

  it('treats flipping a chapter back as no change', async () => {
    const review = await mountReview()

    await includeBox(review, 'One').setValue(false)
    await includeBox(review, 'One').setValue(true)

    expect(resyncButton(review).attributes('disabled')).toBeDefined()
  })

  it('starts from the decisions the job already holds', async () => {
    const review = await mountReview(makeJob({ status: 'awaiting_review', decisions: { chapters: { 'chapter-1.xhtml': 'excluded' }, audio: [] } }))

    expect((includeBox(review, 'One').element as HTMLInputElement).checked).toBe(false)
  })

  it('shows the chapter text on request', async () => {
    const review = await mountReview()
    const toggle = review.find(`button[aria-label="${t('book.detail.files.readAloud.review.showText', { title: 'One' })}"]`)

    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')

    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(review.text()).toContain('It was a bright cold day in April.')
  })

  it('emits discard only after the inline confirmation', async () => {
    const review = await mountReview()
    const discard = () => review.findAll('button').filter((button) => button.text().trim() === t('book.detail.files.readAloud.review.discard'))

    await discard()[0]!.trigger('click')
    expect(review.emitted('discard')).toBeUndefined()
    await discard()[0]!.trigger('click')

    expect(review.emitted('discard')).toHaveLength(1)
  })

  it('offers no discard for a review the server would no longer let go', async () => {
    const review = await mountReview(makeJob({ status: 'awaiting_review', cancellable: false }))

    const texts = review.findAll('button').map((button) => button.text().trim())
    expect(texts).not.toContain(t('book.detail.files.readAloud.review.discard'))
    expect(texts).toContain(t('book.detail.files.readAloud.review.publishAnyway'))
  })
})
