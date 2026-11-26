import { describe, expect, it } from 'vitest'
import { mount, RouterLinkStub } from '@vue/test-utils'
import type { SeriesSummary } from '@bookorbit/types'
import SeriesIndexRow from './SeriesIndexRow.vue'

const base: SeriesSummary = {
  id: 9,
  name: 'Harbor of Lanterns',
  bookCount: 30,
  readCount: 22,
  readingCount: 1,
  authors: ['Mio Tanabe'],
  coverBookIds: [1],
  lastAddedAt: null,
  libraryNames: ['Manga'],
  expectedBookCount: null,
  ownedVolumeCount: 10,
  readVolumeCount: 10,
  readingVolumeCount: 0,
  volumes: Array.from({ length: 10 }, (_, i) => ({ index: i + 1, bookId: i + 1, title: `Vol. ${i + 1}`, status: 'read' as const })),
  volumesTruncated: false,
  gaps: [],
  gapCount: 0,
  nextBookId: 23,
  nextIndex: '93',
  nextTitle: 'Embers',
  nextUnit: 'chapter',
  unitCounts: { volume: 10, chapter: 20, issue: 0 },
  chapterReadCount: 12,
  chapterGaps: [],
  chapterGapCount: 0,
}

function mountRow(overrides: Partial<SeriesSummary> = {}) {
  return mount(SeriesIndexRow, {
    props: { series: { ...base, ...overrides } },
    global: { stubs: { RouterLink: RouterLinkStub, BookCoverArtwork: true } },
  })
}

function caption(wrapper: ReturnType<typeof mountRow>) {
  return wrapper.get('[data-testid="series-row-caption"]')
}

describe('SeriesIndexRow', () => {
  it('keeps the caption and Up Next of a series without units', () => {
    const wrapper = mountRow({
      unitCounts: undefined,
      chapterReadCount: undefined,
      chapterGaps: undefined,
      chapterGapCount: undefined,
      nextUnit: undefined,
      gaps: [11, 12],
      gapCount: 2,
      readVolumeCount: 4,
    })

    expect(caption(wrapper).text()).toBe('Missing #11, #12')
    expect(caption(wrapper).classes()).toContain('text-destructive')
    expect(wrapper.text()).toContain('#93 · Embers')
    expect(wrapper.text()).toContain('4/10')
  })

  it('counts chapters under the ladder and in the progress', () => {
    const wrapper = mountRow()

    expect(caption(wrapper).text()).toBe('20 chapters · 12 read')
    expect(caption(wrapper).find('.text-destructive').exists()).toBe(false)
    expect(wrapper.text()).toContain('22/30')
    expect(wrapper.text()).toContain('73%')
  })

  it('names missing volumes and chapters by kind', () => {
    const wrapper = mountRow({ gaps: [11], gapCount: 1, chapterGaps: [93, 95], chapterGapCount: 4 })

    expect(caption(wrapper).text()).toBe('Missing Vol. 11 · 20 chapters · 12 read · missing Ch. 93, Ch. 95 +2')
    expect(
      caption(wrapper)
        .findAll('.text-destructive')
        .map((part) => part.text()),
    ).toEqual(['Missing Vol. 11', 'missing Ch. 93, Ch. 95 +2'])
  })

  it('calls them issues when the series holds more issues', () => {
    const wrapper = mountRow({ unitCounts: { volume: 2, chapter: 0, issue: 16 }, chapterGaps: [13, 14], chapterGapCount: 2 })

    expect(caption(wrapper).text()).toBe('16 issues · 12 read · missing #13, #14')
  })

  it('leads Up Next with the unit token', () => {
    expect(mountRow().text()).toContain('Ch. 93 · Embers')
    expect(mountRow({ nextUnit: 'volume', nextIndex: '4', nextTitle: 'Low Water' }).text()).toContain('Vol. 4 · Low Water')
    expect(mountRow({ nextUnit: 'issue', nextIndex: '12', nextTitle: 'The Long Night' }).text()).toContain('#12 · The Long Night')
  })

  it('drops the token when the next title already carries it', () => {
    const wrapper = mountRow({ nextUnit: 'issue', nextIndex: '12', nextTitle: 'Night Warden #12' })

    expect(wrapper.text()).toContain('Night Warden #12')
    expect(wrapper.text()).not.toContain('#12 · Night Warden #12')
  })

  it('says how much of the series is read in its accessible name', () => {
    expect(mountRow().get('a').attributes('aria-label')).toBe('Harbor of Lanterns, 22 of 30 read')
  })
})
