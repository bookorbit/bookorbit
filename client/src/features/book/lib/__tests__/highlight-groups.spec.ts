import { describe, expect, it } from 'vitest'
import type { AnnotationItem, AnnotationStats } from '@bookorbit/types'
import { buildHighlightGroups, highlightDay, NO_CHAPTER_KEY, withLoadedItems } from '../highlight-groups'

function item(overrides: Partial<AnnotationItem> = {}): AnnotationItem {
  return {
    id: 1,
    bookId: 84,
    cfi: 'epubcfi(/6/4!/4/2/4:0)',
    jumpFileId: 88,
    pageno: null,
    text: 'Call me Ishmael.',
    color: '#FACC15',
    style: 'highlight',
    note: null,
    chapterTitle: 'Loomings',
    origin: 'kobo',
    positionStatus: 'exact',
    chapterIndex: null,
    createdAt: '2026-04-02T19:30:00.000Z',
    ...overrides,
  }
}

function stats(overrides: Partial<AnnotationStats> = {}): AnnotationStats {
  return {
    totalHighlights: 0,
    colorBreakdown: [],
    originBreakdown: [],
    chaptersWithHighlights: 0,
    highlightsWithNotes: 0,
    chapters: [],
    chapterBreakdown: [],
    activity: [],
    ...overrides,
  }
}

describe('buildHighlightGroups by chapter', () => {
  it('takes its totals from the aggregate, not from the loaded window', () => {
    const groups = buildHighlightGroups(
      [item({ id: 1 })],
      stats({
        chapterBreakdown: [
          {
            title: 'Loomings',
            count: 8,
            colors: [{ color: '#FACC15', count: 8 }],
            chapterIndex: 0,
            order: 0,
            firstCreatedAt: '2026-04-02T19:30:00.000Z',
          },
        ],
      }),
      'chapter',
    )

    expect(groups).toHaveLength(1)
    expect(groups[0].total).toBe(8)
    expect(groups[0].items).toHaveLength(1)
  })

  it('lists chapters that have nothing loaded yet, so the index describes the whole book', () => {
    const groups = buildHighlightGroups(
      [item({ id: 1, chapterTitle: 'Loomings' })],
      stats({
        chapterBreakdown: [
          { title: 'Loomings', count: 1, colors: [], chapterIndex: 0, order: 0, firstCreatedAt: '2026-04-02T19:30:00.000Z' },
          { title: 'Cetology', count: 5, colors: [], chapterIndex: 31, order: 31, firstCreatedAt: '2026-05-02T19:30:00.000Z' },
        ],
      }),
      'chapter',
    )

    expect(groups.map((g) => g.label)).toEqual(['Loomings', 'Cetology'])
    expect(groups[1].items).toEqual([])
    expect(withLoadedItems(groups).map((g) => g.label)).toEqual(['Loomings'])
  })

  it('keeps the aggregate order rather than the order highlights happen to arrive in', () => {
    const groups = buildHighlightGroups(
      [item({ id: 1, chapterTitle: 'Cetology' }), item({ id: 2, chapterTitle: 'Loomings' })],
      stats({
        chapterBreakdown: [
          { title: 'Loomings', count: 1, colors: [], chapterIndex: 0, order: 0, firstCreatedAt: '2026-04-02T19:30:00.000Z' },
          { title: 'Cetology', count: 1, colors: [], chapterIndex: 31, order: 31, firstCreatedAt: '2026-05-02T19:30:00.000Z' },
        ],
      }),
      'chapter',
    )

    expect(groups.map((g) => g.label)).toEqual(['Loomings', 'Cetology'])
  })

  it('prints a one-based chapter number only when a position resolved to one', () => {
    const groups = buildHighlightGroups(
      [],
      stats({
        chapterBreakdown: [
          { title: 'Loomings', count: 1, colors: [], chapterIndex: 0, order: 0, firstCreatedAt: '2026-04-02T19:30:00.000Z' },
          { title: 'Unplaced', count: 1, colors: [], chapterIndex: null, order: null, firstCreatedAt: '2026-04-02T19:30:00.000Z' },
        ],
      }),
      'chapter',
    )

    expect(groups[0].index).toBe(1)
    expect(groups[1].index).toBeNull()
  })

  it('still shows a highlight whose chapter is missing from the aggregate', () => {
    const groups = buildHighlightGroups([item({ chapterTitle: 'Raced In' })], stats(), 'chapter')

    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Raced In')
    expect(groups[0].total).toBe(1)
  })

  it('keys untitled chapters on the shared constant so callers cannot drift apart', () => {
    const groups = buildHighlightGroups([item({ chapterTitle: null })], stats(), 'chapter')

    expect(groups[0].key).toBe(NO_CHAPTER_KEY)
  })

  it('groups highlights with no chapter title together', () => {
    const groups = buildHighlightGroups([item({ id: 1, chapterTitle: null }), item({ id: 2, chapterTitle: null })], stats(), 'chapter')

    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBeNull()
    expect(groups[0].items).toHaveLength(2)
  })
})

describe('buildHighlightGroups by colour', () => {
  it('takes its totals from the colour aggregate', () => {
    const groups = buildHighlightGroups(
      [item({ id: 1, color: '#FACC15' })],
      stats({
        colorBreakdown: [
          { color: '#FACC15', count: 70 },
          { color: '#38BDF8', count: 35 },
        ],
      }),
      'colour',
    )

    expect(groups.map((g) => [g.label, g.total])).toEqual([
      ['#FACC15', 70],
      ['#38BDF8', 35],
    ])
    expect(groups[0].colour).toBe('#FACC15')
    expect(groups[0].items).toHaveLength(1)
  })
})

describe('buildHighlightGroups by day', () => {
  it('groups by the viewer time zone and puts the newest day first', () => {
    const groups = buildHighlightGroups(
      [item({ id: 1, createdAt: '2026-04-02T12:00:00.000Z' }), item({ id: 2, createdAt: '2026-04-05T12:00:00.000Z' })],
      stats(),
      'day',
    )

    expect(groups.map((g) => g.label)).toEqual([
      highlightDay(item({ createdAt: '2026-04-05T12:00:00.000Z' })),
      highlightDay(item({ createdAt: '2026-04-02T12:00:00.000Z' })),
    ])
    expect(groups[0].total).toBe(1)
  })

  it('puts highlights made on the same day in one group', () => {
    const groups = buildHighlightGroups(
      [item({ id: 1, createdAt: '2026-04-02T09:00:00.000Z' }), item({ id: 2, createdAt: '2026-04-02T11:00:00.000Z' })],
      stats(),
      'day',
    )

    expect(groups).toHaveLength(1)
    expect(groups[0].total).toBe(2)
  })
})

describe('highlightDay', () => {
  it('returns an empty key for an unparseable timestamp', () => {
    expect(highlightDay(item({ createdAt: 'not a date' }))).toBe('')
  })
})
