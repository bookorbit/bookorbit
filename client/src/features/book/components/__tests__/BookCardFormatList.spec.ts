import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { BookCardLinkInfo } from '@bookorbit/types'
import { i18n } from '@/i18n'
import BookCardFormatList from '../BookCardFormatList.vue'

const linked: BookCardLinkInfo = {
  groupId: 3,
  memberCount: 2,
  books: [{ bookId: 9, libraryId: 2, formats: ['m4b'], mediaKind: 'audiobook' }],
}

beforeEach(() => {
  i18n.global.locale.value = 'en'
})

describe('BookCardFormatList', () => {
  it('lists the own formats, then the linked ones marked as linked', () => {
    const wrapper = mount(BookCardFormatList, { props: { ownKeys: ['epub', 'pdf'], linked } })

    const chips = wrapper.findAll('[data-testid="card-format-list-chip"]')
    expect(chips.map((chip) => chip.text())).toEqual([
      expect.stringContaining('EPUB'),
      expect.stringContaining('PDF'),
      expect.stringContaining('M4B'),
    ])
    expect(chips[2]!.find('[data-testid="format-chip-linked"]').exists()).toBe(true)
  })

  it('renders nothing for a single format, which the badge already names', () => {
    const wrapper = mount(BookCardFormatList, { props: { ownKeys: ['epub'] } })
    expect(wrapper.find('[data-testid="card-format-list"]').exists()).toBe(false)
  })

  it('folds formats past the sixth into a count', () => {
    const wrapper = mount(BookCardFormatList, { props: { ownKeys: ['epub', 'pdf', 'mobi', 'azw3', 'fb2', 'djvu', 'txt', 'cbz'] } })

    expect(wrapper.findAll('[data-testid="card-format-list-chip"]')).toHaveLength(6)
    expect(wrapper.get('[data-testid="card-format-list-more"]').text()).toBe('+2')
  })
})
