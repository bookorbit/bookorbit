import { describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import type { SeriesSummary } from '@bookorbit/types'
import SeriesCard from './SeriesCard.vue'

vi.mock('@/features/book/composables/useCoverVersions', () => ({
  useCoverVersions: () => ({
    coverUrl: (bookId: number) => `/covers/${bookId}`,
  }),
}))

const BookCoverArtworkStub = defineComponent({
  name: 'BookCoverArtwork',
  emits: ['load', 'error'],
  template: '<div data-testid="series-cover-artwork" />',
})

function makeSeries(overrides: Partial<SeriesSummary> = {}): SeriesSummary {
  return {
    id: 42,
    name: 'Harry Potter Audio',
    bookCount: 7,
    readCount: 2,
    authors: ['J.K. Rowling'],
    coverBookIds: [101],
    lastAddedAt: null,
    ...overrides,
  }
}

function mountCard(series: SeriesSummary): VueWrapper {
  return mount(SeriesCard, {
    props: { series },
    global: {
      stubs: {
        BookCoverArtwork: BookCoverArtworkStub,
        SeriesCompletionBar: true,
      },
    },
  })
}

function getCoverStyle(wrapper: VueWrapper): string {
  const artwork = wrapper.get('[data-testid="series-cover-artwork"]')
  return artwork.element.parentElement?.getAttribute('style') ?? ''
}

function getCoverStyleAt(wrapper: VueWrapper, index: number): string {
  const artworks = wrapper.findAll('[data-testid="series-cover-artwork"]')
  return artworks[index]!.element.parentElement?.getAttribute('style') ?? ''
}

describe('SeriesCard', () => {
  it('emits open on card click and renders compact author text', async () => {
    const wrapper = mountCard(makeSeries({ authors: ['A1', 'A2', 'A3'] }))

    await wrapper.get('.group.flex.h-full.cursor-pointer.flex-col').trigger('click')

    expect(wrapper.emitted('open')).toEqual([[42]])
    expect(wrapper.text()).toContain('A1, A2 +1')
  })

  it('keeps non-square covers at base scale', async () => {
    const wrapper = mountCard(makeSeries())
    const artwork = wrapper.getComponent(BookCoverArtworkStub)

    artwork.vm.$emit('load', 0.66)
    await nextTick()

    const style = getCoverStyle(wrapper)
    expect(style).toContain('scale(1)')
    expect(style).toContain('transform-origin: center')
  })

  it('enlarges square covers and anchors them to the bottom', async () => {
    const wrapper = mountCard(makeSeries())
    const artwork = wrapper.getComponent(BookCoverArtworkStub)

    artwork.vm.$emit('load', 1)
    await nextTick()

    const style = getCoverStyle(wrapper)
    expect(style).toContain('scale(1.25)')
    expect(style).toContain('transform-origin: center bottom')
  })

  it('applies and clears hover transforms across the stack', async () => {
    const wrapper = mountCard(makeSeries({ coverBookIds: [101, 102] }))
    const wrappers = wrapper.findAll('.absolute.overflow-hidden.rounded-lg')

    await wrappers[0]!.trigger('mouseenter')
    await nextTick()

    expect(getCoverStyleAt(wrapper, 0)).toContain('translateY(-8px) scale(1.05)')
    expect(getCoverStyleAt(wrapper, 1)).toContain('opacity: 0.58')

    await wrapper.get('.relative.isolate.overflow-hidden.border-b.border-border\\/60').trigger('mouseleave')
    await nextTick()

    expect(getCoverStyleAt(wrapper, 0)).toContain('translateY(0) scale(1)')
  })

  it('falls back to initial when the visible cover fails', async () => {
    const wrapper = mountCard(makeSeries({ name: 'Resident Evil', coverBookIds: [101] }))
    const artwork = wrapper.getComponent(BookCoverArtworkStub)

    artwork.vm.$emit('error')
    await nextTick()

    expect(wrapper.find('[data-testid="series-cover-artwork"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('R')
  })
})
