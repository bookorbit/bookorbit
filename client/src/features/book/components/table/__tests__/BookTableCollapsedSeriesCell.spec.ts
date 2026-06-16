import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { BookCard } from '@bookorbit/types'
import BookTableCollapsedSeriesCell from '../BookTableCollapsedSeriesCell.vue'

function makeBook(format: string | null): BookCard {
  return {
    id: 1,
    status: 'present',
    title: 'Saga',
    authors: [],
    seriesName: 'Saga',
    seriesIndex: null,
    files: format ? [{ id: 1, format, role: 'primary', sizeBytes: null }] : [],
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
    collapsedSeries: { bookCount: 3, readCount: 1, coverBookIds: [10, 11], seriesLatestAddedAt: null },
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
})
