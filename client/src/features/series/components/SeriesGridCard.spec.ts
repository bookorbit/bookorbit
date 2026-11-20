import { describe, expect, it } from 'vitest'
import { mount, RouterLinkStub } from '@vue/test-utils'
import type { SeriesSummary } from '@bookorbit/types'
import SeriesGridCard from './SeriesGridCard.vue'

const series: SeriesSummary = {
  id: 4,
  name: 'Discworld',
  bookCount: 3,
  readCount: 1,
  readingCount: 0,
  authors: ['Terry Pratchett'],
  coverBookIds: [10],
  lastAddedAt: null,
  libraryNames: ['Novels'],
  expectedBookCount: null,
  ownedVolumeCount: 2,
  readVolumeCount: 1,
  readingVolumeCount: 0,
  volumes: [
    { index: 1, bookId: 10, title: 'One', status: 'read' },
    { index: 3, bookId: 12, title: 'Three', status: 'unread' },
  ],
  volumesTruncated: false,
  gaps: [],
  gapCount: 0,
  nextBookId: 12,
  nextIndex: '3',
  nextTitle: 'Three',
}

function mountCard() {
  return mount(SeriesGridCard, {
    props: { series },
    global: { stubs: { RouterLink: RouterLinkStub, BookCoverArtwork: true } },
  })
}

describe('SeriesGridCard', () => {
  it('is a link to the series page, so the browser can open it in a new tab', () => {
    const wrapper = mountCard()

    expect(wrapper.get('a').attributes('role')).toBeUndefined()
    expect(wrapper.findComponent(RouterLinkStub).props('to')).toEqual({ name: 'series-detail', params: { seriesId: 4 } })
  })

  it('emits open on a plain click', async () => {
    const wrapper = mountCard()

    await wrapper.get('a').trigger('click')

    expect(wrapper.emitted('open')).toEqual([[4]])
  })

  it('leaves a Ctrl+click to the browser', async () => {
    const wrapper = mountCard()

    await wrapper.get('a').trigger('click', { ctrlKey: true })

    expect(wrapper.emitted('open')).toBeUndefined()
  })

  it('opens on the space bar, which a link does not activate by itself', async () => {
    const wrapper = mountCard()

    await wrapper.get('a').trigger('keydown', { key: ' ' })

    expect(wrapper.emitted('open')).toEqual([[4]])
  })
})
