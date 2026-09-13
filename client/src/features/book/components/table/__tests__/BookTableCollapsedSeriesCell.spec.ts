import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { BookCard } from '@bookorbit/types'
import BookTableCollapsedSeriesCell from '../BookTableCollapsedSeriesCell.vue'

vi.mock('@/features/book/composables/useCoverVersions', () => ({
  useCoverVersions: () => ({
    coverUrl: (bookId: number, type = 'thumbnail', version?: string | number | Date | null) => {
      const base = `/api/v1/books/${bookId}/${type}`
      return version == null ? base : `${base}?t=${new Date(version).getTime()}`
    },
  }),
}))

function makeBook(format: string | null): BookCard {
  return {
    id: 1,
    status: 'present',
    coverAspectRatio: '2/3',
    title: 'Saga',
    authors: [],
    seriesName: 'Saga',
    seriesIndex: null,
    files: format ? [{ id: 1, format, role: 'primary', sizeBytes: null }] : [],
    publishedDate: null,
    publishedYear: null,
    language: null,
    genres: [],
    tags: [],
    rating: null,
    readingProgress: null,
    readStatus: null,
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    metadataScore: null,
    hasCover: false,
    hasMetadataLocks: false,
    lockedFields: [],
    subtitle: null,
    publisher: null,
    pageCount: null,
    isbn13: null,
    narrators: [],
    customMetadata: [],
    collapsedSeries: {
      bookCount: 3,
      readCount: 1,
      coverBookIds: [10, 11],
      coverUpdatedAtByBookId: { 10: '2024-01-01T00:00:00.000Z', 11: '2024-02-01T00:00:00.000Z' },
      seriesLatestAddedAt: null,
    },
  } as BookCard
}

const CoverSurfaceStub = {
  name: 'BookCoverSurface',
  props: ['isComic', 'disableSpine'],
  template: '<div data-testid="surface" :data-comic="isComic"><slot /></div>',
}

function mountCell(format: string | null, colId = 'cover') {
  return mount(BookTableCollapsedSeriesCell, {
    props: { book: makeBook(format), colId },
    global: {
      stubs: {
        BookCoverSurface: CoverSurfaceStub,
        Tooltip: { template: '<div><slot /></div>' },
        TooltipTrigger: { template: '<div><slot /></div>' },
        TooltipContent: { template: '<div data-testid="tooltip-content"><slot /></div>' },
      },
    },
  })
}

describe('BookTableCollapsedSeriesCell comic flag', () => {
  it('flags comic series covers via isComic', () => {
    const wrapper = mountCell('cbz')
    const surfaces = wrapper.findAll('[data-testid="surface"]')

    expect(surfaces.length).toBeGreaterThan(0)
    expect(surfaces.every((s) => s.attributes('data-comic') === 'true')).toBe(true)
  })

  it('does not flag non-comic series covers', () => {
    const wrapper = mountCell('epub')
    const surfaces = wrapper.findAll('[data-testid="surface"]')

    expect(surfaces.every((s) => s.attributes('data-comic') === 'false')).toBe(true)
  })

  it('versions collapsed cover thumbnails with child timestamps', () => {
    const wrapper = mountCell('epub')
    const imgs = wrapper.findAll('img')

    expect(imgs[0]!.attributes('src')).toBe('/api/v1/books/10/thumbnail?t=1704067200000')
    expect(imgs[1]!.attributes('src')).toBe('/api/v1/books/11/thumbnail?t=1706745600000')
  })

  it('identifies the series marker with a keyboard-triggered tooltip', () => {
    const wrapper = mountCell('epub', 'lockRow')
    const marker = wrapper.get('[role="img"]')

    expect(marker.attributes('aria-label')).toBe('Series row')
    expect(marker.attributes('tabindex')).toBe('0')
    expect(wrapper.get('[data-testid="tooltip-content"]').text()).toBe('Series row')
  })

  it('offers a labeled button to open the series', async () => {
    const wrapper = mountCell('epub', 'actions')
    const button = wrapper.get('button')

    expect(button.attributes('aria-label')).toBe('Open series')
    expect(wrapper.get('[data-testid="tooltip-content"]').text()).toBe('Open series')
    await button.trigger('click')
    expect(wrapper.emitted('open-series')).toEqual([[]])
  })
})
