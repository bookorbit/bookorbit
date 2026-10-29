import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { ChapterLookupResult, ChapterPauseWindow } from '@bookorbit/types'
import { setI18nLocale } from '@/i18n'
import { fromDraft, toDraft, type DraftChapter } from '@/features/book/lib/chapter-edit'
import type { ReviewSource } from '@/features/book/composables/useChapterReview'
import type { AnalyzePauses } from '@/features/book/lib/chapter-snap'
import ChapterSourceSheet, { type ChapterSourceRequest } from '../ChapterSourceSheet.vue'

const current = toDraft([
  { title: 'Track 1', startMs: 0 },
  { title: 'Track 2', startMs: 10_000 },
  { title: 'Track 3', startMs: 600_000 },
])

const LOOKUP: ChapterLookupResult = {
  provider: 'audible',
  asin: 'B0FR69VKMH',
  region: 'us',
  chapters: [
    { title: 'Opening Credits', startMs: 0, lengthMs: null, children: [] },
    { title: 'Chapter 1', startMs: 14_040, lengthMs: null, children: [] },
    { title: 'Chapter 2', startMs: 604_040, lengthMs: null, children: [] },
  ],
  runtimeMs: 1_009_040,
  brandIntroMs: 4_040,
  brandOutroMs: 5_000,
  isAccurate: true,
}

/** The book's own audio pauses just before 10 s and 600 s, where its chapters really start. */
const analyzePauses = vi.fn<AnalyzePauses>(async (points, windowMs): Promise<ChapterPauseWindow[]> =>
  points.map((pointMs) => ({
    pointMs,
    fromMs: pointMs - windowMs / 2,
    toMs: pointMs + windowMs / 2,
    pauses: [
      { startMs: 7_000, endMs: 10_300 },
      { startMs: 597_000, endMs: 600_300 },
    ].filter((pause) => pause.endMs > pointMs - windowMs / 2 && pause.startMs < pointMs + windowMs / 2),
    failed: false,
  })),
)

let wrapper: VueWrapper | null = null

async function open(request: ChapterSourceRequest, source: ReviewSource | null = null, asin: string | null = null) {
  await setI18nLocale('en')
  wrapper = mount(ChapterSourceSheet, {
    props: {
      request: null,
      source: null,
      current,
      totalDurationMs: 1_000_000,
      loading: false,
      error: null,
      lookupAsin: asin,
      lookupRegion: 'uk',
      analyzePauses,
    },
    attachTo: document.body,
  })
  await wrapper.setProps({ request })
  if (source) await wrapper.setProps({ source })
  await flushPromises()
}

function dialog(): HTMLElement {
  return document.body.querySelector<HTMLElement>('[role="dialog"]')!
}

function button(label: string): HTMLButtonElement {
  return [...dialog().querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent?.trim().startsWith(label))!
}

async function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input'))
  await flushPromises()
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('ChapterSourceSheet', () => {
  it('prefills the lookup with the book ASIN and store, and asks for an uppercased one', async () => {
    await open({ kind: 'lookup' }, null, 'B0FR69VKMH')

    const asin = dialog().querySelector<HTMLInputElement>('input')!
    const region = dialog().querySelector<HTMLSelectElement>('select')!
    expect(asin.value).toBe('B0FR69VKMH')
    expect(region.value).toBe('uk')

    await type(asin, 'b003zwfo7e')
    button('Look up').click()
    await flushPromises()

    expect(wrapper!.emitted('lookup')![0]).toEqual(['B003ZWFO7E', 'uk'])
  })

  it('offers the Audible intro as an offset and applies the shifted chapters', async () => {
    await open({ kind: 'lookup' }, { kind: 'lookup', chapters: [], lookup: LOOKUP, runtimeMs: LOOKUP.runtimeMs }, 'B0FR69VKMH')

    expect(dialog().textContent).toContain('Audible marks these timings as exact')
    button("Skip Audible's intro").click()
    await flushPromises()

    expect(dialog().textContent).toContain('Replaces the list with 3 chapters')
    button('Apply to editor').click()
    await flushPromises()

    const [applied, changed] = wrapper!.emitted('apply')![0] as [DraftChapter[], number]
    expect(fromDraft(applied)).toEqual([
      { title: 'Opening Credits', startMs: 0 },
      { title: 'Chapter 1', startMs: 10_000 },
      { title: 'Chapter 2', startMs: 600_000 },
    ])
    expect(changed).toBe(3)
  })

  it('fits the offset to the pauses in the book and offers it again once found', async () => {
    await open({ kind: 'lookup' }, { kind: 'lookup', chapters: [], lookup: LOOKUP, runtimeMs: LOOKUP.runtimeMs }, 'B0FR69VKMH')

    button('Fit to pauses').click()
    await flushPromises()

    expect(analyzePauses).toHaveBeenCalledWith([14_040, 604_040], 60_000, expect.any(AbortSignal))
    expect(dialog().querySelector<HTMLInputElement>('input[inputmode="decimal"]')!.value).toBe('-4.05')
    expect(button('Fit to pauses (').textContent).toContain('2 of 2')
  })

  it('cancels a stale pause fit and leaves a replacement source at its own offset', async () => {
    let release!: (value: ChapterPauseWindow[]) => void
    analyzePauses.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    await open({ kind: 'lookup' }, { kind: 'lookup', chapters: [], lookup: LOOKUP })
    button('Fit to pauses').click()
    await flushPromises()
    const signal = analyzePauses.mock.calls.at(-1)![2]!
    await wrapper!.setProps({ source: { kind: 'files', chapters: fromDraft(current) } })
    expect(signal.aborted).toBe(true)
    release([{ pointMs: 14_040, fromMs: 0, toMs: 60_000, pauses: [{ startMs: 7_000, endMs: 10_300 }], failed: false }])
    await flushPromises()
    expect(dialog().querySelector<HTMLInputElement>('input[inputmode="decimal"]')!.value).toBe('0')
  })

  it('reads a pasted list of titles and lays them on in order', async () => {
    await open({ kind: 'import' })

    await type(dialog().querySelector('textarea')!, 'Prologue\nChapter One')
    button('Read chapters').click()
    await flushPromises()

    expect(dialog().querySelector<HTMLInputElement>('input[type="radio"][value="titles"]')!.checked).toBe(true)
    expect(dialog().textContent).toContain('2 chapters change')
    button('Apply to editor').click()
    await flushPromises()

    const [applied] = wrapper!.emitted('apply')![0] as [DraftChapter[]]
    expect(applied.map((row) => row.title)).toEqual(['Prologue', 'Chapter One', 'Track 3'])
    expect(applied[0]!.key).toBe(current[0]!.key)
  })

  it('drops an unticked row from a replace', async () => {
    await open({ kind: 'files' }, { kind: 'files', chapters: fromDraft(current) })

    const boxes = dialog().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    boxes[1]!.click()
    await flushPromises()

    expect(dialog().textContent).toContain('Replaces the list with 2 chapters')
    button('Apply to editor').click()
    await flushPromises()

    const [applied] = wrapper!.emitted('apply')![0] as [DraftChapter[]]
    expect(applied.map((row) => row.title)).toEqual(['Track 1', 'Track 3'])
  })

  it('says nothing would change when the source matches the editor', async () => {
    await open({ kind: 'files' }, { kind: 'files', chapters: fromDraft(current) })

    expect(dialog().textContent).toContain('Nothing would change')
    expect(button('Apply to editor').disabled).toBe(true)
  })

  it('says when a source has no chapters instead of staying blank', async () => {
    await open({ kind: 'files' }, { kind: 'files', chapters: [] })

    expect(dialog().textContent).toContain('No chapters were found here.')
    expect(button('Apply to editor')).toBeUndefined()
  })
})
