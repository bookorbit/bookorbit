import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import type { BookCardLinkInfo, Library } from '@bookorbit/types'
import { i18n } from '@/i18n'
import BookCardFormatBadges from '../BookCardFormatBadges.vue'

const libraries = ref<Library[]>([])
vi.mock('@/features/library/composables/useLibraries', () => ({ useLibraries: () => ({ libraries }) }))

const linked: BookCardLinkInfo = {
  groupId: 3,
  memberCount: 2,
  books: [{ bookId: 9, libraryId: 2, formats: ['m4b'], mediaKind: 'audiobook' }],
}

beforeEach(() => {
  i18n.global.locale.value = 'en'
  libraries.value = [{ id: 2, name: 'Audiobooks' }] as Library[]
})

describe('BookCardFormatBadges', () => {
  it('shows the card own format and a linked book format, marked as linked', () => {
    const wrapper = mount(BookCardFormatBadges, { props: { ownKeys: ['epub'], linked } })

    const badges = wrapper.findAll('[data-testid="card-format-badge"]')
    expect(badges.map((badge) => badge.text())).toEqual([expect.stringContaining('EPUB'), expect.stringContaining('M4B')])
    expect(badges[0]!.attributes('data-linked')).toBeUndefined()
    expect(badges[1]!.attributes('data-linked')).toBe('true')
    // The linked badge differs by shape too, not only by its label.
    expect(badges[1]!.find('[data-testid="format-chip-linked"]').exists()).toBe(true)
    expect(badges[0]!.find('[data-testid="format-chip-linked"]').exists()).toBe(false)
  })

  it('describes the whole list in words, naming the linked book library', () => {
    const wrapper = mount(BookCardFormatBadges, { props: { ownKeys: ['epub'], linked } })
    expect(wrapper.get('[data-testid="card-format-badges-summary"]').text()).toBe('Formats: EPUB e-book. Linked books: M4B audiobook in Audiobooks')
  })

  it('keeps the plain summary for a card that is not linked', () => {
    const wrapper = mount(BookCardFormatBadges, { props: { ownKeys: ['epub', 'pdf'] } })
    expect(wrapper.get('[data-testid="card-format-badges-summary"]').text()).toBe('Formats: EPUB e-book, PDF document')
    expect(wrapper.find('[data-linked="true"]').exists()).toBe(false)
  })

  it('folds badges past the third into a count', () => {
    const wrapper = mount(BookCardFormatBadges, {
      props: {
        ownKeys: ['epub', 'pdf', 'mobi'],
        linked: { ...linked, books: [{ bookId: 9, libraryId: 2, formats: ['m4b', 'mp3'], mediaKind: 'audiobook' }] },
      },
    })
    expect(wrapper.findAll('[data-testid="card-format-badge"]')).toHaveLength(3)
    expect(wrapper.get('[data-testid="card-format-badges-more"]').text()).toBe('+2')
    expect(wrapper.get('[data-testid="card-format-badges-summary"]').text()).toContain('M4B audiobook in Audiobooks')
  })

  it('renders nothing without any format', () => {
    const wrapper = mount(BookCardFormatBadges, { props: { ownKeys: [] } })
    expect(wrapper.find('[data-testid="card-format-badges"]').exists()).toBe(false)
  })
})
