import { beforeEach, describe, expect, it } from 'vitest'
import { mount, RouterLinkStub } from '@vue/test-utils'
import type { LinkedBookSummary } from '@bookorbit/types'
import { i18n } from '@/i18n'
import EditionStrip from '../EditionStrip.vue'
import type { EditionEntry } from '@/features/book/lib/book-editions'

function entry(bookId: number, label: string, extra: Partial<LinkedBookSummary> = {}, current = false): EditionEntry {
  return {
    label,
    current,
    summary: {
      bookId,
      libraryId: 1,
      libraryName: 'Novels',
      title: 'Jurassic Park',
      formats: ['epub'],
      mediaKind: 'ebook',
      status: 'present',
      isLead: false,
      ...extra,
    },
  }
}

function mountStrip(editions: EditionEntry[], layout: 'wrap' | 'scroll' = 'wrap') {
  return mount(EditionStrip, { props: { editions, layout }, global: { stubs: { RouterLink: RouterLinkStub } } })
}

describe('EditionStrip', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'en'
  })

  it('names the edition this page shows with its formats, library and this reader’s progress', () => {
    const wrapper = mountStrip([
      entry(1, 'Ballantine Books · 2012', { formats: ['epub', 'm4b'], progress: { percentage: 100, finished: true } }, true),
      entry(2, 'Full Cast', { formats: ['m4b'], libraryName: 'Audiobooks', mediaKind: 'audiobook', progress: { percentage: 35, finished: false } }),
      entry(3, 'Read-along', { libraryName: 'ReadAloud+' }),
    ])

    expect(wrapper.get('nav').attributes('aria-label')).toBe('Editions')
    const pills = wrapper.findAll('[data-testid="edition-pill"]')
    expect(pills.map((pill) => pill.attributes('aria-label'))).toEqual(['Ballantine Books · 2012, EPUB and M4B, in Novels, finished'])
    expect(pills[0]!.attributes('aria-current')).toBe('page')
    expect(pills[0]!.find('[data-testid="edition-pill-finished"]').exists()).toBe(true)
    expect(wrapper.findAllComponents(RouterLinkStub).map((link) => link.props('to'))).toEqual([{ name: 'book-detail', params: { bookId: 1 } }])
  })

  it('shows this edition’s progress, or that its files are missing', () => {
    const reading = mountStrip([entry(1, 'Main'), entry(2, 'Full Cast', { progress: { percentage: 35, finished: false } }, true)])
    expect(reading.get('[data-testid="edition-pill"]').attributes('aria-label')).toBe('Full Cast, EPUB, in Novels, 35% read')
    expect(reading.get('[data-testid="edition-pill"]').text()).toContain('35%')

    const lost = mountStrip([entry(1, 'Main'), entry(2, 'Lost', { status: 'missing', progress: { percentage: 40, finished: false } }, true)])
    const pill = lost.get('[data-testid="edition-pill"]')
    expect(pill.attributes('aria-label')).toBe('Lost, EPUB, in Novels, files missing')
    expect(pill.find('[data-testid="edition-pill-missing"]').exists()).toBe(true)
    expect(pill.text()).not.toContain('40%')
  })

  it('keeps to one line however many editions there are, with a button for all of them', async () => {
    const editions = [1, 2, 3, 4, 5, 6].map((id) => entry(id, `Edition ${id}`, {}, id === 6))
    const wrapper = mountStrip(editions)

    expect(wrapper.findAll('[data-testid="edition-pill"]').map((pill) => pill.get('span[dir="auto"]').text())).toEqual(['Edition 6'])
    const all = wrapper.get('[data-testid="edition-strip-all"]')
    expect(all.text()).toBe('All 6 editions')
    expect(all.attributes('aria-label')).toBe('Show all 6 editions')

    await all.trigger('click')
    expect(wrapper.emitted('show-all')).toHaveLength(1)
  })

  it('keeps one scrolling line on narrow screens, with a shorter button', () => {
    const wrapper = mountStrip([entry(1, 'A', {}, true), entry(2, 'B')], 'scroll')
    expect(wrapper.get('nav').classes()).toContain('flex-nowrap')
    expect(wrapper.get('ul').classes()).toContain('overflow-x-auto')
    expect(wrapper.get('[data-testid="edition-strip-all"]').text()).toBe('All 2')
    expect(wrapper.get('[data-testid="edition-strip-all"]').attributes('aria-label')).toBe('Show all 2 editions')
  })

  it('draws nothing for a book with no other edition', () => {
    expect(
      mountStrip([entry(1, 'Only', {}, true)])
        .find('nav')
        .exists(),
    ).toBe(false)
  })
})
