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

function mountCell(format: string | null) {
  return mount(BookTableCollapsedSeriesCell, {
    props: { book: makeBook(format), colId: 'cover' as never },
    global: { stubs: { BookCoverSurface: CoverSurfaceStub } },
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
})
