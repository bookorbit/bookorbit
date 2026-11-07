import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import type { BookCardLinkInfo, FormatBadgeStyle, Library } from '@bookorbit/types'
import { i18n } from '@/i18n'
import BookCardFormatBadges from '../BookCardFormatBadges.vue'

const libraries = ref<Library[]>([])
vi.mock('@/features/library/composables/useLibraries', () => ({ useLibraries: () => ({ libraries }) }))

const linked: BookCardLinkInfo = {
  groupId: 3,
  memberCount: 2,
  books: [{ bookId: 9, libraryId: 2, formats: ['m4b'], mediaKind: 'audiobook' }],
}

function mountBadges(badgeStyle: FormatBadgeStyle, ownKeys: string[], link?: BookCardLinkInfo) {
  return mount(BookCardFormatBadges, { props: { ownKeys, linked: link ?? null, badgeStyle } })
}

beforeEach(() => {
  i18n.global.locale.value = 'en'
  libraries.value = [{ id: 2, name: 'Audiobooks' }] as Library[]
})

describe('BookCardFormatBadges', () => {
  it('renders nothing without any format', () => {
    const wrapper = mountBadges('seal', [])
    expect(wrapper.find('[data-testid="card-format-badges"]').exists()).toBe(false)
  })

  it('shows one pill for the primary format, however many formats the book has', () => {
    const wrapper = mountBadges('primary', ['epub', 'pdf', 'mobi'])

    const badges = wrapper.findAll('[data-testid="card-format-badge"]')
    expect(badges).toHaveLength(1)
    expect(badges[0]!.text()).toContain('EPUB')
  })

  it.each<FormatBadgeStyle>(['bubble', 'underline', 'pips', 'seal', 'dots', 'kinds'])(
    'falls back to the plain pill for a single format in the %s style',
    (style) => {
      const wrapper = mountBadges(style, ['epub'])

      expect(wrapper.get('[data-testid="card-format-badges"]').attributes('data-badge-style')).toBe('primary')
      expect(wrapper.findAll('[data-testid="card-format-badge"]')).toHaveLength(1)
    },
  )

  it('draws a seal arc per format with the count inside, a linked arc thinner', () => {
    const wrapper = mountBadges('seal', ['epub', 'pdf'], linked)

    const arcs = wrapper.findAll('[data-testid="card-format-arc"]')
    expect(arcs).toHaveLength(3)
    expect(arcs.map((arc) => arc.attributes('stroke-width'))).toEqual(['4', '4', '2'])
    expect(arcs[2]!.attributes('data-linked')).toBe('true')
    expect(wrapper.get('[data-testid="card-format-seal-count"]').text()).toBe('3')
  })

  it('folds seal arcs past the eighth into one gray arc', () => {
    const keys = ['epub', 'pdf', 'mobi', 'azw3', 'fb2', 'djvu', 'txt', 'cbz', 'm4b', 'mp3']
    const wrapper = mountBadges('seal', keys)

    expect(wrapper.findAll('[data-testid="card-format-arc"]')).toHaveLength(8)
    expect(wrapper.get('[data-testid="card-format-seal-count"]').text()).toBe('10')
  })

  it('keeps the full primary pill and counts the other formats in a bubble', () => {
    const wrapper = mountBadges('bubble', ['epub', 'pdf', 'mobi'])

    expect(wrapper.get('[data-testid="card-format-badge"]').text()).toContain('EPUB')
    expect(wrapper.get('[data-testid="card-format-badges-more"]').text()).toBe('+2')
  })

  it('counts a linked book format in the bubble too', () => {
    const wrapper = mountBadges('bubble', ['epub'], linked)
    expect(wrapper.get('[data-testid="card-format-badges-more"]').text()).toBe('+1')
  })

  it('draws a pip per other format above the pill, a linked pip hollow', () => {
    const wrapper = mountBadges('pips', ['epub', 'pdf'], linked)

    expect(wrapper.get('[data-testid="card-format-badge"]').text()).toContain('EPUB')
    const pips = wrapper.findAll('[data-testid="card-format-pip"]')
    expect(pips).toHaveLength(2)
    expect(pips[0]!.classes()).not.toContain('border')
    expect(pips[1]!.classes()).toContain('border')
    expect(pips[1]!.attributes('data-linked')).toBe('true')
  })

  it('keeps four pips and a gray one for the rest past five other formats', () => {
    const wrapper = mountBadges('pips', ['epub', 'pdf', 'mobi', 'azw3', 'fb2', 'djvu', 'txt', 'cbz'])

    const pips = wrapper.findAll('[data-testid="card-format-pip"]')
    expect(pips).toHaveLength(5)
    expect(pips[4]!.attributes('style')).not.toBe(pips[3]!.attributes('style'))
  })

  it('draws an underline segment per other format under a flat-bottomed pill, a linked segment thinner', () => {
    const wrapper = mountBadges('underline', ['epub', 'pdf'], linked)

    expect(wrapper.get('[data-testid="card-format-badge"]').classes()).toContain('rounded-b-none')
    const segments = wrapper.findAll('[data-testid="card-format-segment"]')
    expect(segments).toHaveLength(2)
    expect(segments[0]!.classes()).not.toContain('h-px')
    expect(segments[1]!.classes()).toContain('h-px')
  })

  it('draws a dot per format, a linked dot hollow', () => {
    const wrapper = mountBadges('dots', ['epub'], linked)

    const dots = wrapper.findAll('[data-testid="card-format-dot"]')
    expect(dots).toHaveLength(2)
    expect(dots[0]!.classes()).not.toContain('border-[1.5px]')
    expect(dots[1]!.classes()).toContain('border-[1.5px]')
  })

  it('keeps four dots and a count past five formats', () => {
    const wrapper = mountBadges('dots', ['epub', 'pdf', 'mobi', 'azw3', 'fb2', 'djvu'])

    expect(wrapper.findAll('[data-testid="card-format-dot"]')).toHaveLength(4)
    expect(wrapper.get('[data-testid="card-format-badges-more"]').text()).toBe('+2')
  })

  it('shows the primary format, the media kinds and the count in the kinds style', () => {
    const wrapper = mountBadges('kinds', ['epub'], linked)

    expect(wrapper.get('[data-testid="card-format-badge"]').text()).toContain('EPUB')
    expect(wrapper.findAll('[data-kind]').map((icon) => icon.attributes('data-kind'))).toEqual(['ebook', 'audiobook'])
    expect(wrapper.get('[data-testid="card-format-badges-more"]').text()).toBe('+1')
  })

  it('describes the whole list in words in every style, naming the linked book library', () => {
    for (const style of ['primary', 'bubble', 'underline', 'pips', 'seal', 'dots', 'kinds'] as const) {
      const wrapper = mountBadges(style, ['epub'], linked)
      expect(wrapper.get('[data-testid="card-format-badges-summary"]').text()).toBe('Formats: EPUB e-book. Linked books: M4B audiobook in Audiobooks')
    }
  })

  it('keeps the plain summary for a card that is not linked', () => {
    const wrapper = mountBadges('dots', ['epub', 'pdf'])
    expect(wrapper.get('[data-testid="card-format-badges-summary"]').text()).toBe('Formats: EPUB e-book, PDF document')
    expect(wrapper.find('[data-linked="true"]').exists()).toBe(false)
  })
})
