// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { SeriesSummary, SeriesVolumeSlot } from '@bookorbit/types'
import { parseAddedAt, seriesAuthorLine, seriesCoverSlots, seriesExtraAuthorCount, seriesRowFacts } from './series-summary'

function slot(overrides: Partial<SeriesVolumeSlot> = {}): SeriesVolumeSlot {
  return { index: 1, bookId: 1, title: 'One', status: 'unread', ...overrides }
}

function summary(overrides: Partial<SeriesSummary> = {}): SeriesSummary {
  return {
    id: 1,
    name: 'Series',
    bookCount: 1,
    readCount: 0,
    readingCount: 0,
    authors: [],
    coverBookIds: [],
    lastAddedAt: null,
    libraryNames: [],
    expectedBookCount: null,
    ownedVolumeCount: 1,
    readVolumeCount: 0,
    readingVolumeCount: 0,
    volumes: [],
    volumesTruncated: false,
    gaps: [],
    gapCount: 0,
    nextBookId: null,
    nextIndex: null,
    nextTitle: null,
    ...overrides,
  }
}

describe('seriesRowFacts', () => {
  it('reports volumes rather than books, so two editions of one volume count once', () => {
    const facts = seriesRowFacts(summary({ bookCount: 4, readCount: 2, ownedVolumeCount: 2, readVolumeCount: 1 }))

    expect(facts.ownedVolumes).toBe(2)
    expect(facts.readVolumes).toBe(1)
    expect(facts.percentRead).toBe(50)
  })

  it('counts a series past the capped ladder instead of stopping at the cap', () => {
    const volumes = Array.from({ length: 60 }, (_, i) => slot({ index: i + 1, bookId: i + 1, status: 'read' }))
    const facts = seriesRowFacts(
      summary({ bookCount: 300, readCount: 60, ownedVolumeCount: 300, readVolumeCount: 60, volumes, volumesTruncated: true }),
    )

    expect(facts.ownedVolumes).toBe(300)
    expect(facts.readVolumes).toBe(60)
    expect(facts.percentRead).toBe(20)
    expect(facts.isComplete).toBe(false)
  })

  it('reports the volumes in progress', () => {
    const facts = seriesRowFacts(summary({ ownedVolumeCount: 9, readVolumeCount: 4, readingVolumeCount: 1 }))

    expect(facts.readingVolumes).toBe(1)
    expect(facts.isStarted).toBe(true)
  })

  it('flags gaps from the gap count', () => {
    expect(seriesRowFacts(summary({ gaps: [2], gapCount: 1 })).hasGaps).toBe(true)
  })

  it('is complete only when every owned volume is read', () => {
    expect(seriesRowFacts(summary({ ownedVolumeCount: 2, readVolumeCount: 2 })).isComplete).toBe(true)
    expect(seriesRowFacts(summary({ ownedVolumeCount: 0, readVolumeCount: 0, bookCount: 0 })).isComplete).toBe(false)
  })
})

describe('seriesCoverSlots', () => {
  it('drops missing rungs, which have no cover to show', () => {
    const slots = seriesCoverSlots(
      summary({ volumes: [slot({ index: 1, bookId: 1 }), slot({ index: 2, bookId: null, status: 'missing' }), slot({ index: 3, bookId: 3 })] }),
    )

    expect(slots.map((s) => s.bookId)).toEqual([1, 3])
  })

  it('falls back to the cover ids when the ladder could not be built', () => {
    const slots = seriesCoverSlots(summary({ volumes: [], coverBookIds: [7, 8] }))
    expect(slots.map((s) => s.bookId)).toEqual([7, 8])
  })
})

describe('seriesAuthorLine', () => {
  it('names up to two authors and counts the rest', () => {
    expect(seriesAuthorLine(summary({ authors: [] }))).toBeNull()
    expect(seriesAuthorLine(summary({ authors: ['A'] }))).toBe('A')
    expect(seriesAuthorLine(summary({ authors: ['A', 'B', 'C', 'D'] }))).toBe('A, B')
    expect(seriesExtraAuthorCount(summary({ authors: ['A', 'B', 'C', 'D'] }))).toBe(2)
  })
})

describe('parseAddedAt', () => {
  it('parses the Postgres timestamp shape the API actually returns', () => {
    // Space separator and a two-digit offset; neither is ISO 8601.
    const parsed = parseAddedAt('2026-08-15 04:35:41.046562+00')
    expect(parsed).not.toBeNull()
    expect(parsed!.toISOString()).toBe('2026-08-15T04:35:41.046Z')
  })

  it('handles a non-UTC two-digit offset', () => {
    expect(parseAddedAt('2026-08-15 04:35:41+02')!.toISOString()).toBe('2026-08-15T02:35:41.000Z')
  })

  it('still accepts a proper ISO string', () => {
    expect(parseAddedAt('2026-08-15T04:35:41.000Z')!.toISOString()).toBe('2026-08-15T04:35:41.000Z')
  })

  it('returns null rather than an Invalid Date', () => {
    expect(parseAddedAt(null)).toBeNull()
    expect(parseAddedAt('not a date')).toBeNull()
  })
})
