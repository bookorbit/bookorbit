// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import type { ChapterLookupNode, ChapterLookupResult } from '@bookorbit/types'
import { fromDraft, toDraft } from '../../lib/chapter-edit'
import { useChapterReview } from '../useChapterReview'

const CURRENT = toDraft([
  { title: 'Track 1', startMs: 0 },
  { title: 'Track 2', startMs: 10_000 },
  { title: 'Track 3', startMs: 600_000 },
])

function node(title: string, startMs: number, children: ChapterLookupNode[] = []): ChapterLookupNode {
  return { title, startMs, lengthMs: null, children }
}

function lookup(overrides: Partial<ChapterLookupResult> = {}): ChapterLookupResult {
  return {
    provider: 'audible',
    asin: 'B0FR69VKMH',
    region: 'us',
    chapters: [node('Opening Credits', 0), node('Part One', 14_040, [node('Chapter 1', 18_040)]), node('Chapter 2', 604_040)],
    runtimeMs: 1_009_040,
    brandIntroMs: 4_040,
    brandOutroMs: 5_000,
    isAccurate: true,
    ...overrides,
  }
}

function makeReview(total: number | null = 1_000_000) {
  return useChapterReview(ref(CURRENT), ref(total))
}

describe('useChapterReview', () => {
  it('flattens a lookup tree and lets the part headings be dropped', () => {
    const review = makeReview()
    review.open({ kind: 'lookup', chapters: [], lookup: lookup() })

    expect(review.showsParts.value).toBe(true)
    expect(review.incoming.value.map((chapter) => chapter.title)).toEqual(['Opening Credits', 'Part One', 'Chapter 1', 'Chapter 2'])

    review.partsMode.value = 'drop'

    expect(review.incoming.value.map((chapter) => chapter.title)).toEqual(['Opening Credits', 'Chapter 1', 'Chapter 2'])
  })

  it('suggests the Audible intro and shifts the incoming times by the chosen offset', () => {
    const review = makeReview()
    review.open({ kind: 'lookup', chapters: [], lookup: lookup() })

    expect(review.suggestions.value[0]).toEqual({ kind: 'brandIntro', offsetMs: -4_040 })

    review.offsetMs.value = -4_040

    expect(review.incoming.value.map((chapter) => chapter.startMs)).toEqual([0, 10_000, 14_000, 600_000])
    expect(review.availableScale.value).toBeNull()
  })

  it('offers a stretch only when the shifted chapters still miss the book, and applies it when asked', () => {
    const review = makeReview(990_000)
    review.open({ kind: 'lookup', chapters: [], lookup: lookup() })
    review.offsetMs.value = -4_040

    const scale = review.availableScale.value!
    expect(scale).toBeLessThan(1)
    expect(review.stretchShiftMs.value).toBeCloseTo(600_000 * (scale - 1))
    expect(review.incoming.value[3]!.startMs).toBe(600_000)

    review.stretch.value = true

    expect(review.incoming.value[3]!.startMs).toBe(Math.round(600_000 * scale))
  })

  it('matches by time so an extra incoming chapter keeps its own row', () => {
    const review = makeReview()
    review.open({ kind: 'lookup', chapters: [], lookup: lookup() })
    review.offsetMs.value = -4_040

    expect(review.rows.value).toEqual([
      { currentIndex: 0, incomingIndex: 0, deltaMs: 0 },
      { currentIndex: 1, incomingIndex: 1, deltaMs: 0 },
      { currentIndex: null, incomingIndex: 2, deltaMs: null },
      { currentIndex: 2, incomingIndex: 3, deltaMs: 0 },
    ])
    expect(review.matchedCount.value).toBe(3)

    review.applyMode.value = 'titles'
    const result = review.apply()

    expect(result.changed).toBe(3)
    expect(fromDraft(result.draft).map((chapter) => chapter.title)).toEqual(['Opening Credits', 'Part One', 'Chapter 2'])
  })

  it('leaves out rows past the end of the book and rows the person unticks', () => {
    const review = makeReview(500_000)
    review.open({ kind: 'files', chapters: [...fromDraft(CURRENT), { title: 'Extra', startMs: 400_000 }].sort((a, b) => a.startMs - b.startMs) })

    expect([...review.pastEnd.value]).toEqual([3])
    expect([...review.included.value]).toEqual([0, 1, 2])

    review.toggleRow(1)

    expect(fromDraft(review.apply().draft).map((chapter) => chapter.title)).toEqual(['Track 1', 'Extra'])

    review.toggleRow(1)

    expect(review.included.value.has(1)).toBe(true)
  })

  it('treats a table of contents as titles laid on in order, with no shift or suggestions', () => {
    const review = makeReview()
    review.open({
      kind: 'toc',
      chapters: [
        { title: 'Prologue', startMs: 0 },
        { title: 'One', startMs: 0 },
      ],
      titlesOnly: true,
    })

    expect(review.applyMode.value).toBe('titles')
    expect(review.suggestions.value).toEqual([])
    expect(review.availableScale.value).toBeNull()
    expect(review.pastEnd.value.size).toBe(0)
    expect(fromDraft(review.apply().draft).map((chapter) => chapter.title)).toEqual(['Prologue', 'One', 'Track 3'])
  })

  it('slides the remaining titles up when front matter is left out', () => {
    const review = makeReview()
    review.open({
      kind: 'toc',
      chapters: ['About the Author', 'Prologue', 'One', 'Two'].map((title) => ({ title, startMs: 0 })),
      titlesOnly: true,
    })

    review.toggleRow(0)

    expect(review.matchedCount.value).toBe(3)
    expect(fromDraft(review.apply().draft).map((chapter) => chapter.title)).toEqual(['Prologue', 'One', 'Two'])
  })

  it('resets every choice when a new source opens', () => {
    const review = makeReview()
    review.open({ kind: 'lookup', chapters: [], lookup: lookup() })
    review.offsetMs.value = -4_040
    review.stretch.value = true
    review.partsMode.value = 'prefix'
    review.matchMode.value = 'position'
    review.toggleRow(0)

    review.open({ kind: 'tracks', chapters: fromDraft(CURRENT) })

    expect(review.offsetMs.value).toBe(0)
    expect(review.stretch.value).toBe(false)
    expect(review.partsMode.value).toBe('own')
    expect(review.matchMode.value).toBe('time')
    expect(review.applyMode.value).toBe('replace')
    expect(review.included.value.size).toBe(3)
    expect(review.showsParts.value).toBe(false)
  })
})

it('clears source exclusions when part handling changes row identity', () => {
  const review = useChapterReview(ref(CURRENT), ref(1000000))
  review.open({ kind: 'lookup', chapters: [], lookup: lookup() })
  review.toggleRow(1)
  review.partsMode.value = 'drop'
  expect(review.included.value.size).toBe(review.incoming.value.length)
})
