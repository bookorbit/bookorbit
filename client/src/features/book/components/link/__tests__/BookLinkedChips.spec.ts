import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { LinkedBookSummary } from '@bookorbit/types'
import { i18n } from '@/i18n'
import BookLinkedChips from '../BookLinkedChips.vue'

function linkedBook(overrides: Partial<LinkedBookSummary> = {}): LinkedBookSummary {
  return {
    bookId: 41,
    libraryId: 2,
    libraryName: 'Audiobooks',
    title: 'Dune',
    formats: ['m4b'],
    mediaKind: 'audiobook',
    status: 'present',
    isLead: false,
    ...overrides,
  }
}

function mountChips(books: LinkedBookSummary[]) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/book/:bookId', name: 'book-detail', component: { template: '<div />' } }],
  })
  return mount(BookLinkedChips, { props: { books }, global: { plugins: [router] } })
}

beforeEach(() => {
  i18n.global.locale.value = 'en'
})

describe('BookLinkedChips', () => {
  it('renders nothing when the book has no visible linked books', () => {
    const wrapper = mountChips([])
    expect(wrapper.find('[data-testid="linked-books"]').exists()).toBe(false)
  })

  it('links each chip to its book and names it by medium and library', () => {
    const wrapper = mountChips([linkedBook(), linkedBook({ bookId: 42, libraryName: 'Comics', formats: ['cbz'], mediaKind: 'comic' })])

    expect(wrapper.text()).toContain('Also available as')
    const chips = wrapper.findAll('[data-testid="linked-book-chip"]')
    expect(chips).toHaveLength(2)
    expect(chips[0]!.attributes('href')).toBe('/book/41')
    expect(chips[0]!.attributes('aria-label')).toBe('Audiobook in Audiobooks library')
    expect(chips[0]!.text()).toContain('M4B')
    expect(chips[0]!.text()).toContain('Audiobooks')
    expect(chips[1]!.attributes('href')).toBe('/book/42')
    expect(chips[1]!.attributes('aria-label')).toBe('Comic in Comics library')
  })

  it('labels the chip list with its heading', () => {
    const wrapper = mountChips([linkedBook()])
    const list = wrapper.get('ul')
    const heading = wrapper.get(`#${list.attributes('aria-labelledby')}`)
    expect(heading.text()).toBe('Also available as')
  })

  it('says a linked book is missing in words, not by colour', () => {
    const wrapper = mountChips([linkedBook({ status: 'missing' })])
    const chip = wrapper.get('[data-testid="linked-book-chip"]')
    expect(chip.attributes('aria-label')).toBe('Audiobook in Audiobooks library, files missing')
    expect(wrapper.get('[data-testid="linked-book-chip-missing"]').text()).toBe('Missing')
  })

  it('still names a linked book without content formats', () => {
    const wrapper = mountChips([linkedBook({ formats: [], mediaKind: 'unknown' })])
    expect(wrapper.get('[data-testid="linked-book-chip"]').attributes('aria-label')).toBe('Book in Audiobooks library')
  })
})
