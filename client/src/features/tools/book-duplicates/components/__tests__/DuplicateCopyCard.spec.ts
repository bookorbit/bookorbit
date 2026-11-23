import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { BookDuplicateAction, BookDuplicateCandidate, BookDuplicateKind } from '@bookorbit/types'

import { activateI18nLocale } from '@/i18n'
import DuplicateCopyCard from '../DuplicateCopyCard.vue'

const book = {
  id: 2,
  title: 'Japanese Gothic',
  folderPath: 'Kylie Lee Baker/Japanese Gothic (2026)/Japanese Gothic (2026).epub',
  libraryName: 'Novels',
  files: [{ id: 2, format: 'epub', sizeBytes: 2_300_000, path: 'Japanese Gothic (2026).epub' }],
  readingProgress: 39.57,
  authors: ['Kylie Lee Baker'],
  status: 'present',
  metadataScore: 88,
  readStatus: null,
  collections: [],
  addedAt: '2026-08-19T00:00:00.000Z',
  hasCover: false,
  bookPerFile: false,
} as unknown as BookDuplicateCandidate

function status(keeper: boolean, action: BookDuplicateAction | null, kind?: BookDuplicateKind): string {
  const wrapper = mount(DuplicateCopyCard, {
    props: { book, groupId: 7, index: 0, keeper, recommended: false, action, kind },
    global: { stubs: { BookCoverImage: true } },
  })
  return wrapper.find('span.uppercase').text()
}

describe('DuplicateCopyCard', () => {
  it('names what happens to a copy that is not kept from the group action', () => {
    activateI18nLocale('en')
    expect(status(false, 'delete')).toBe('Delete')
    expect(status(false, 'merge')).toBe('Merge in')
    expect(status(false, 'link')).toBe('Link')
    expect(status(false, null)).toBe('Other copy')
    expect(status(true, null)).toBe('Keeping')
    expect(status(true, 'link')).toBe('Main book')
  })

  it('names the copies of other editions being grouped as editions, and keeps link wording elsewhere', () => {
    activateI18nLocale('en')
    expect(status(true, 'link', 'other_edition')).toBe('Main edition')
    expect(status(false, 'link', 'other_edition')).toBe('Other edition')
    expect(status(false, 'merge', 'other_edition')).toBe('Merge in')
    expect(status(true, 'link', 'other_format')).toBe('Main book')
    expect(status(false, 'link', 'other_format')).toBe('Link')
  })

  it('shows reading progress sent from 0 to 100 as that percentage', () => {
    activateI18nLocale('en')
    const wrapper = mount(DuplicateCopyCard, {
      props: { book, groupId: 7, index: 0, keeper: false, recommended: false, action: null },
      global: { stubs: { BookCoverImage: true } },
    })
    expect(wrapper.text()).toContain('40%')
    expect(wrapper.text()).not.toContain('3,957%')
  })
})
