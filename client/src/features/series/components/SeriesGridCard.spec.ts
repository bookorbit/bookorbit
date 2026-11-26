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

function mountCard(overrides: Partial<SeriesSummary> = {}) {
  return mount(SeriesGridCard, {
    props: { series: { ...series, ...overrides } },
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

  describe('series units', () => {
    const manga: Partial<SeriesSummary> = {
      name: 'Harbor of Lanterns',
      bookCount: 30,
      ownedVolumeCount: 10,
      readVolumeCount: 10,
      unitCounts: { volume: 10, chapter: 20, issue: 0 },
      chapterReadCount: 12,
      chapterGaps: [],
      chapterGapCount: 0,
    }

    it('keeps the volume count chip and caption for a series without chapters', () => {
      const wrapper = mountCard({ unitCounts: { volume: 2, chapter: 0, issue: 0 }, chapterReadCount: 0 })

      expect(wrapper.get('[data-testid="series-card-count"]').text()).toBe('2')
      expect(wrapper.find('[data-testid="series-card-chapters"]').exists()).toBe(false)
      expect(wrapper.get('a').attributes('aria-label')).toBe('Discworld, 1 of 2 volumes read')
    })

    it('counts volumes and chapters apart on the chip', () => {
      const wrapper = mountCard(manga)

      const chip = wrapper.get('[data-testid="series-card-count"]')
      expect(chip.text()).toBe('10 + 20')
      expect(chip.attributes('title')).toBe('10 volumes · 20 chapters')
    })

    it('says how many chapters are read, and counts them in the progress', () => {
      const wrapper = mountCard(manga)

      const line = wrapper.get('[data-testid="series-card-chapters"]')
      expect(line.text()).toContain('20 chapters')
      expect(line.text()).toContain('12 read')
      expect(wrapper.text()).toContain('22/30')
      expect(wrapper.get('a').attributes('aria-label')).toBe('Harbor of Lanterns, 22 of 30 read')
    })

    it('lists missing issues by kind in the destructive colour', () => {
      const wrapper = mountCard({
        ...manga,
        gaps: [3],
        gapCount: 1,
        unitCounts: { volume: 2, chapter: 0, issue: 16 },
        chapterGaps: [13, 14],
        chapterGapCount: 2,
      })

      const line = wrapper.get('[data-testid="series-card-chapters"]')
      expect(line.text()).toContain('16 issues')
      const missing = line.get('.text-destructive')
      expect(missing.text()).toBe('missing Vol. 3, #13, #14')
    })

    it('shows only the chapter count for a series of chapters alone', () => {
      // With no volumes the server's ladder counts are the chapters, as clients before units expect.
      const wrapper = mountCard({
        ...manga,
        ownedVolumeCount: 20,
        readVolumeCount: 12,
        volumes: [],
        unitCounts: { volume: 0, chapter: 20, issue: 0 },
      })

      expect(wrapper.get('[data-testid="series-card-count"]').text()).toBe('20')
      expect(wrapper.text()).toContain('12/20')
    })

    it('names the gaps of an issue-only series once, by issue number', () => {
      const wrapper = mountCard({
        ...manga,
        ownedVolumeCount: 3,
        readVolumeCount: 0,
        chapterReadCount: 0,
        volumes: [],
        unitCounts: { volume: 0, chapter: 0, issue: 3 },
        gaps: [3],
        gapCount: 1,
        chapterGaps: [3],
        chapterGapCount: 1,
      })

      expect(wrapper.get('[data-testid="series-card-chapters"]').text()).toContain('missing #3')
      expect(wrapper.get('[data-testid="series-card-chapters"]').text()).not.toContain('Vol.')
      expect(wrapper.text()).toContain('0/3')
    })
  })
})
