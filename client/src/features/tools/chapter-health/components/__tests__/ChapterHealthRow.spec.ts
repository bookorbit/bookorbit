import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { ChapterHealthBook, ChapterLookupReviewSummary } from '@bookorbit/types'
import { setI18nLocale } from '@/i18n'
import ChapterHealthRow from '../ChapterHealthRow.vue'

function book(overrides: Partial<ChapterHealthBook> = {}): ChapterHealthBook {
  return {
    bookId: 4,
    title: 'Dune',
    authors: ['Frank Herbert'],
    libraryName: 'Audiobooks',
    audioFiles: 2,
    chapterCount: 14,
    source: null,
    audibleId: 'B002V1OF70',
    review: null,
    ...overrides,
  }
}

function runtimeSummary(runtimeMs: number | null, totalDurationMs: number | null): ChapterLookupReviewSummary {
  return { provider: 'audible', chapterCount: 20, runtimeMs, totalDurationMs, isAccurate: true }
}

let wrapper: VueWrapper | null = null

function mountRow(entry: ChapterHealthBook, options: { selectable?: boolean; selected?: boolean } = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/book/:bookId', name: 'book-detail', component: { template: '<div />' } },
    ],
  })
  wrapper = mount(ChapterHealthRow, {
    props: { book: entry, selectable: options.selectable ?? true, selected: options.selected ?? false },
    global: { plugins: [router] },
  })
  return wrapper
}

function link(name: string) {
  return wrapper!.findAll('a').find((candidate) => candidate.text().trim() === name)
}

beforeEach(async () => {
  await setI18nLocale('en')
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('ChapterHealthRow', () => {
  it('names the book, its authors and its files, chapters and library', () => {
    mountRow(book({ authors: ['Frank Herbert', 'Scott Brick'] }))

    expect(wrapper!.text()).toContain('Frank Herbert, Scott Brick')
    expect(wrapper!.text()).toContain('2 files; 14 chapters; Audiobooks')
  })

  it('counts a single file and no chapters', () => {
    mountRow(book({ audioFiles: 1, chapterCount: 0 }))

    expect(wrapper!.text()).toContain('1 file; no chapters; Audiobooks')
  })

  it('falls back to a placeholder title', () => {
    mountRow(book({ title: null }))

    expect(link('Untitled book')).toBeDefined()
    expect(wrapper!.get('input[type="checkbox"]').attributes('aria-label')).toBe('Select Untitled book')
  })

  it('links the title to the book chapters tab', () => {
    mountRow(book())

    expect(link('Dune')!.attributes('href')).toBe('/book/4?tab=chapters')
  })

  it('shows the ASIN and lets the book be selected', async () => {
    mountRow(book())

    expect(wrapper!.text()).toContain('B002V1OF70')
    expect(wrapper!.text()).not.toContain('No ASIN')

    const checkbox = wrapper!.get('input[type="checkbox"]')
    expect(checkbox.attributes('aria-label')).toBe('Select Dune')
    expect(checkbox.attributes('disabled')).toBeUndefined()

    await checkbox.setValue(true)
    expect(wrapper!.emitted('toggle')).toEqual([[4]])
  })

  it('says when there is no ASIN and keeps the book out of a selection', () => {
    mountRow(book({ audibleId: null }))

    expect(wrapper!.text()).toContain('No ASIN')
    expect(wrapper!.get('input[type="checkbox"]').attributes('disabled')).toBeDefined()
  })

  it('reflects the selection and drops the checkbox where nothing can be selected', () => {
    mountRow(book(), { selected: true })
    expect((wrapper!.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true)

    wrapper!.unmount()
    mountRow(book(), { selectable: false })
    expect(wrapper!.find('input[type="checkbox"]').exists()).toBe(false)
  })

  it('offers no review actions outside the review list', () => {
    mountRow(book())

    expect(link('Review')).toBeUndefined()
    expect(wrapper!.find('button').exists()).toBe(false)
  })

  it('gives a short runtime difference in seconds', () => {
    mountRow(book({ review: { reason: 'runtime_mismatch', summary: runtimeSummary(3_600_000, 3_642_500) } }))

    expect(wrapper!.text()).toContain("Audible's runtime differs from your files by 42.5 s.")
  })

  it('gives a difference of a minute and a half or more as a clock', () => {
    mountRow(book({ review: { reason: 'runtime_mismatch', summary: runtimeSummary(36_000_000, 36_090_000) } }))
    expect(wrapper!.text()).toContain("Audible's runtime differs from your files by 1:30, so it is probably a different edition.")

    wrapper!.unmount()
    mountRow(book({ review: { reason: 'runtime_mismatch', summary: runtimeSummary(39_725_000, 36_000_000) } }))
    expect(wrapper!.text()).toContain("Audible's runtime differs from your files by 1:02:05, so it is probably a different edition.")
  })

  it('says when Audible lists no runtime instead of leaving a blank number', () => {
    mountRow(book({ review: { reason: 'runtime_mismatch', summary: { ...runtimeSummary(3_600_000, 3_600_000), runtimeMs: null } } }))

    expect(wrapper!.text()).toContain('Audible does not list a runtime for this book')
    expect(wrapper!.text()).not.toContain('by  s')
  })

  it.each([
    ['not_exact', 'Audible does not mark these timings as exact.'],
    ['implausible', "Audible's list does not look like chapters for this book."],
    ['unknown_length', "This book's length is unknown."],
    ['locked', "This book's chapters are protected, so nothing was replaced."],
  ] as const)('explains the %s review reason', (reason, text) => {
    mountRow(book({ review: { reason, summary: null } }))

    expect(wrapper!.text()).toContain(text)
  })

  it('opens the chapters with the Audible lookup ready from Review, and emits Dismiss', async () => {
    mountRow(book({ review: { reason: 'not_exact', summary: null } }))

    expect(link('Review')!.attributes('href')).toBe('/book/4?tab=chapters&find=audible')

    await wrapper!.get('button').trigger('click')
    expect(wrapper!.get('button').text()).toBe('Dismiss')
    expect(wrapper!.emitted('dismiss')).toEqual([[4]])
  })

  it('keeps the actions for a review row without a recorded reason', () => {
    mountRow(book({ review: { reason: null, summary: null } }))

    expect(link('Review')).toBeDefined()
    expect(wrapper!.get('button').text()).toBe('Dismiss')
  })
})
