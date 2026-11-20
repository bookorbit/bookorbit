import { describe, expect, it } from 'vitest'
import { mount, RouterLinkStub } from '@vue/test-utils'
import type { TaxonomySummary } from '@bookorbit/types'
import TaxonomyIndexRow from './TaxonomyIndexRow.vue'

const item: TaxonomySummary = {
  id: 9,
  name: 'Fantasy',
  bookCount: 12,
  readCount: 3,
  readingCount: 0,
  libraryCount: 2,
  lastAddedAt: null,
  coverBookIds: [],
}

const to = { name: 'genre-detail', params: { id: 9 }, query: { libraryId: '2' } }

function mountRow() {
  return mount(TaxonomyIndexRow, {
    props: { item, to },
    global: { stubs: { RouterLink: RouterLinkStub, BookCoverArtwork: true } },
  })
}

describe('TaxonomyIndexRow', () => {
  it('is a link to the given page, keeping the library filter', () => {
    const wrapper = mountRow()

    expect(wrapper.get('a').attributes('role')).toBe('row')
    expect(wrapper.findComponent(RouterLinkStub).props('to')).toEqual(to)
  })

  it('emits open on a plain click and leaves a Ctrl+click to the browser', async () => {
    const wrapper = mountRow()

    await wrapper.get('a').trigger('click', { ctrlKey: true })
    expect(wrapper.emitted('open')).toBeUndefined()

    await wrapper.get('a').trigger('click')
    expect(wrapper.emitted('open')).toEqual([[9]])
  })
})
