import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { BookDetail } from '@bookorbit/types'
import { activateI18nLocale, i18n } from '@/i18n'

import FilesHeroBar from '../FilesHeroBar.vue'

const t = i18n.global.t
let wrapper: VueWrapper | null = null

const BOOK = { id: 12, title: 'Dune', coverSource: null, coverVersion: null, status: 'present', files: [] } as unknown as BookDetail

beforeAll(() => {
  activateI18nLocale('en')
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

function mountBar(props: { readAloudNote?: string | null; readAloudRetryable?: boolean; readAloudChecking?: boolean } = {}) {
  wrapper = mount(FilesHeroBar, {
    attachTo: document.body,
    props: {
      book: BOOK,
      fileCount: 2,
      totalBytes: 2048,
      runtimeLabel: null,
      formatShares: [],
      folderSegments: ['Dune'],
      canUpload: false,
      showReadAloud: true,
      readAloudAvailable: false,
      sortKey: 'name',
      sortDirection: 'asc',
      sortOptions: [],
      readAloudNote: null,
      ...props,
    },
  })
  return wrapper
}

const checkAgainButton = (bar: VueWrapper) => bar.get('[data-test="read-aloud-check-again"]')

describe('FilesHeroBar read-aloud note', () => {
  it('exposes a failed availability check as a status the Create button is described by', () => {
    const bar = mountBar({ readAloudNote: t('book.detail.files.readAloud.loadFailed'), readAloudRetryable: true })

    const note = bar.get('[data-test="read-aloud-note"]')
    expect(note.attributes('role')).toBe('status')
    expect(note.text()).toBe(t('book.detail.files.readAloud.loadFailed'))
    const create = bar.findAll('button').find((button) => button.text().includes(t('book.detail.files.readAloud.action')))!
    expect(create.attributes('aria-describedby')).toBe(note.attributes('id'))
  })

  it('shows the recheck as busy, keeps the button focusable, and ignores clicks until it finishes', async () => {
    const bar = mountBar({ readAloudNote: t('book.detail.files.readAloud.loadFailed'), readAloudRetryable: true })
    const button = checkAgainButton(bar)
    expect(button.text()).toBe(t('book.detail.files.readAloud.checkAgain'))
    expect(button.attributes('aria-busy')).toBeUndefined()

    ;(button.element as HTMLButtonElement).focus()
    await button.trigger('click')
    expect(bar.emitted('retryReadAloud')).toHaveLength(1)

    await bar.setProps({ readAloudChecking: true })
    expect(button.text()).toBe(t('book.detail.files.readAloud.checking'))
    expect(button.attributes('aria-busy')).toBe('true')
    expect(button.attributes('aria-disabled')).toBe('true')
    expect(button.attributes('disabled')).toBeUndefined()
    expect(document.activeElement).toBe(button.element)

    await button.trigger('click')
    expect(bar.emitted('retryReadAloud')).toHaveLength(1)
  })

  it('updates the same status region when the recheck fails again, so the failure is announced', async () => {
    const bar = mountBar({ readAloudNote: t('book.detail.files.readAloud.loadFailed'), readAloudRetryable: true, readAloudChecking: true })
    const note = bar.get('[data-test="read-aloud-note"]')

    await bar.setProps({ readAloudChecking: false, readAloudNote: t('book.detail.files.readAloud.loadFailedAgain', { count: 1 }) })

    expect(bar.get('[data-test="read-aloud-note"]').element).toBe(note.element)
    expect(note.text()).toBe(t('book.detail.files.readAloud.loadFailedAgain', { count: 1 }))
    expect(note.text()).not.toBe(t('book.detail.files.readAloud.loadFailed'))
    expect(checkAgainButton(bar).text()).toBe(t('book.detail.files.readAloud.checkAgain'))
  })

  it('offers no recheck for a reason that checking again cannot change', () => {
    const bar = mountBar({ readAloudNote: t('book.detail.files.readAloud.reasons.worker_unavailable') })

    expect(bar.get('[data-test="read-aloud-note"]').attributes('role')).toBe('status')
    expect(bar.find('[data-test="read-aloud-check-again"]').exists()).toBe(false)
  })
})

/** jsdom lays nothing out, so each part of the strip reports a fixed width and the hero a chosen one. */
const PART_WIDTHS: Record<string, number> = { 'hero-cover': 44, 'hero-stat': 100 }
const ACTION_WIDTH = 90

function stubLayout(heroWidth: { value: number }) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('files-hero') ? heroWidth.value : 0
  })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const part = Object.keys(PART_WIDTHS).find((name) => this.classList.contains(name))
    const width = part ? PART_WIDTHS[part]! : this.parentElement?.classList.contains('hero-actions') ? ACTION_WIDTH : 0
    return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  })
}

class ImmediateResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback([], this as unknown as ResizeObserver)
  }
  unobserve() {}
  disconnect() {}
}

describe('FilesHeroBar stacking', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  // Cover 44, three stats at 100, the divider (1px + 1rem), three actions at 90, and a 12rem title.
  const SINGLE_ROW_NEED = 44 + 300 + 17 + 270 + 192

  it('stacks when one row would squeeze the title below its minimum', async () => {
    vi.stubGlobal('ResizeObserver', ImmediateResizeObserver)
    stubLayout({ value: SINGLE_ROW_NEED - 1 })

    const bar = mountBar()
    await nextTick()

    expect(bar.get('.files-hero').attributes('data-stacked')).toBe('1')
  })

  it('keeps one row while the title has its minimum', async () => {
    vi.stubGlobal('ResizeObserver', ImmediateResizeObserver)
    stubLayout({ value: SINGLE_ROW_NEED })

    const bar = mountBar()
    await nextTick()

    expect(bar.get('.files-hero').attributes('data-stacked')).toBeUndefined()
  })

  it('unstacks only once the row has room to spare, and re-measures when the content changes', async () => {
    vi.stubGlobal('ResizeObserver', ImmediateResizeObserver)
    const heroWidth = { value: SINGLE_ROW_NEED - 40 }
    stubLayout(heroWidth)
    const bar = mountBar()
    await nextTick()
    expect(bar.get('.files-hero').attributes('data-stacked')).toBe('1')

    heroWidth.value = SINGLE_ROW_NEED + 4
    await bar.setProps({ fileCount: 3 })
    await flushPromises()
    expect(bar.get('.files-hero').attributes('data-stacked')).toBe('1')

    heroWidth.value = SINGLE_ROW_NEED + 40
    await bar.setProps({ fileCount: 4 })
    await flushPromises()
    expect(bar.get('.files-hero').attributes('data-stacked')).toBeUndefined()
  })
})
