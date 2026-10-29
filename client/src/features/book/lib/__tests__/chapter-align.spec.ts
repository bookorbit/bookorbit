// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { ChapterLookupNode } from '@bookorbit/types'
import { fromDraft, toDraft } from '../chapter-edit'
import { alignByPosition, alignByTime, applyIncoming, flattenLookup, hasParts, stretchScale, suggestOffsets, transformTimes } from '../chapter-align'

function node(title: string, startMs: number, children: ChapterLookupNode[] = []): ChapterLookupNode {
  return { title, startMs, lengthMs: null, children }
}

const TREE = [
  node('Opening Credits', 0),
  node('Part One', 100_000, [node('1: Stormblessed', 109_000), node('2: Honor Is Dead', 300_000)]),
  node('Epilogue', 900_000),
]

describe('flattenLookup', () => {
  it('keeps part headings as chapters, folds them into titles, or drops them', () => {
    expect(hasParts(TREE)).toBe(true)
    expect(flattenLookup(TREE, 'own').map((chapter) => chapter.title)).toEqual([
      'Opening Credits',
      'Part One',
      '1: Stormblessed',
      '2: Honor Is Dead',
      'Epilogue',
    ])
    expect(flattenLookup(TREE, 'prefix')).toEqual([
      { title: 'Opening Credits', startMs: 0 },
      { title: 'Part One · 1: Stormblessed', startMs: 109_000 },
      { title: 'Part One · 2: Honor Is Dead', startMs: 300_000 },
      { title: 'Epilogue', startMs: 900_000 },
    ])
    expect(flattenLookup(TREE, 'drop')).toHaveLength(4)
  })
})

describe('time transforms', () => {
  it('shifts before stretching and never goes below 0', () => {
    expect(
      transformTimes(
        [
          { title: 'a', startMs: 4_040 },
          { title: 'b', startMs: 104_040 },
        ],
        -4_040,
        1.01,
      ),
    ).toEqual([
      { title: 'a', startMs: 0 },
      { title: 'b', startMs: 101_000 },
    ])
    expect(transformTimes([{ title: 'a', startMs: 1_000 }], -5_000, 1)).toEqual([{ title: 'a', startMs: 0 }])
  })

  it('fits the stretch to the chapter starts rather than the padded runtime', () => {
    const current = [0, 600_000, 1_200_000, 1_800_000, 2_400_000].map((startMs, index) => ({ title: `${index}`, startMs }))
    const incoming = current.map((chapter, index) => ({ title: chapter.title, startMs: index === 0 ? 0 : 4_040 + chapter.startMs * 1.0005 }))

    const scale = stretchScale({
      current,
      incoming,
      offsetMs: -4_040,
      totalDurationMs: 3_000_000,
      runtimeMs: 3_030_000,
      brandIntroMs: 4_040,
      brandOutroMs: 5_000,
    })

    expect(scale).toBeCloseTo(1 / 1.0005, 7)
  })

  it('falls back to the runtime without the sign-off once the intro is skipped', () => {
    const current = [{ title: 'Track 1', startMs: 0 }]
    const incoming = [
      { title: 'a', startMs: 0 },
      { title: 'b', startMs: 1_000_000 },
    ]
    const input = { current, incoming, totalDurationMs: 2_000_000, runtimeMs: 2_014_040, brandIntroMs: 4_040, brandOutroMs: 5_000 }

    expect(stretchScale({ ...input, offsetMs: -4_040 })).toBeCloseTo(2_000_000 / 2_005_000)
    expect(stretchScale({ ...input, offsetMs: 0 })).toBeCloseTo(2_000_000 / 2_014_040)
  })

  it('offers no stretch when the starts already land', () => {
    const chapters = [0, 600_000, 1_200_000, 1_800_000].map((startMs) => ({ title: 'x', startMs }))

    expect(stretchScale({ current: chapters, incoming: chapters, offsetMs: 0, totalDurationMs: 2_000_000, runtimeMs: 2_000_400 })).toBeNull()
    expect(stretchScale({ current: chapters.slice(0, 1), incoming: chapters, offsetMs: 0, totalDurationMs: null, runtimeMs: null })).toBeNull()
  })
})

describe('alignment', () => {
  const current = [
    { title: 'Track 1', startMs: 0 },
    { title: 'Track 2', startMs: 14_377 },
    { title: 'Track 3', startMs: 22_991 },
    { title: 'Track 4', startMs: 600_000 },
  ]
  const incoming = [
    { title: 'Opening Credits', startMs: 0 },
    { title: 'Dedication', startMs: 14_535 },
    { title: 'Part I', startMs: 23_312 },
    { title: 'Bonus', startMs: 300_000 },
    { title: 'Chapter 1', startMs: 600_100 },
  ]

  it('pairs starts within the tolerance and leaves an extra chapter on its own row', () => {
    expect(alignByTime(current, incoming)).toEqual([
      { currentIndex: 0, incomingIndex: 0, deltaMs: 0 },
      { currentIndex: 1, incomingIndex: 1, deltaMs: 158 },
      { currentIndex: 2, incomingIndex: 2, deltaMs: 321 },
      { currentIndex: null, incomingIndex: 3, deltaMs: null },
      { currentIndex: 3, incomingIndex: 4, deltaMs: 100 },
    ])
  })

  it('pairs by position, without a shift for a list of titles', () => {
    expect(alignByPosition(current.slice(0, 2), incoming.slice(0, 3), true)).toEqual([
      { currentIndex: 0, incomingIndex: 0, deltaMs: null },
      { currentIndex: 1, incomingIndex: 1, deltaMs: null },
      { currentIndex: null, incomingIndex: 2, deltaMs: null },
    ])
  })

  it('closes up behind a skipped row when pairing by position', () => {
    expect(alignByPosition(current.slice(0, 2), incoming.slice(0, 3), true, new Set([0]))).toEqual([
      { currentIndex: null, incomingIndex: 0, deltaMs: null },
      { currentIndex: 0, incomingIndex: 1, deltaMs: null },
      { currentIndex: 1, incomingIndex: 2, deltaMs: null },
    ])
    expect(alignByPosition(current.slice(0, 3), incoming.slice(0, 1), false, new Set([0]))).toEqual([
      { currentIndex: null, incomingIndex: 0, deltaMs: null },
      { currentIndex: 0, incomingIndex: null, deltaMs: null },
      { currentIndex: 1, incomingIndex: null, deltaMs: null },
      { currentIndex: 2, incomingIndex: null, deltaMs: null },
    ])
  })

  it('suggests the Audible intro and the median early difference', () => {
    const shifted = current.map((chapter, index) => ({ title: 'x', startMs: index === 0 ? 0 : chapter.startMs + 4_200 }))

    expect(suggestOffsets(current, shifted, 4_040)).toEqual([
      { kind: 'brandIntro', offsetMs: -4_040 },
      { kind: 'matchStarts', offsetMs: -4_200 },
    ])
    expect(suggestOffsets(current, current, 0)).toEqual([])
  })
})

describe('applyIncoming', () => {
  const draft = toDraft([
    { title: 'Track 1', startMs: 0 },
    { title: 'Track 2', startMs: 14_377 },
    { title: 'Track 3', startMs: 22_991 },
  ])
  const incoming = [
    { title: 'Opening Credits', startMs: 500 },
    { title: 'Dedication', startMs: 14_535 },
    { title: 'Part I', startMs: 23_312 },
  ]
  const rows = alignByTime(fromDraft(draft), incoming)

  it('replaces with the chosen rows and starts the book at 0', () => {
    const result = applyIncoming(draft, incoming, rows, 'replace', new Set([0, 2]))

    expect(fromDraft(result.draft)).toEqual([
      { title: 'Opening Credits', startMs: 0 },
      { title: 'Part I', startMs: 23_312 },
    ])
  })

  it('takes titles for matched, included rows only', () => {
    const result = applyIncoming(draft, incoming, rows, 'titles', new Set([0, 1]))

    expect(result.changed).toBe(2)
    expect(fromDraft(result.draft).map((chapter) => chapter.title)).toEqual(['Opening Credits', 'Dedication', 'Track 3'])
    expect(result.draft[0]!.key).toBe(draft[0]!.key)
  })

  it('takes start times but never moves the first chapter off 0', () => {
    const result = applyIncoming(draft, incoming, rows, 'times', new Set([0, 1, 2]))

    expect(fromDraft(result.draft).map((chapter) => chapter.startMs)).toEqual([0, 14_535, 23_312])
    expect(result.changed).toBe(2)
  })
})
