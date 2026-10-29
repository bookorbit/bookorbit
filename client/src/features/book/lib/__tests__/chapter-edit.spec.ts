// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  chaptersFromTracks,
  cleanTitle,
  cleanTitles,
  fromDraft,
  indexAtTime,
  insertChapterAfter,
  InvalidPatternError,
  mergeShortChapters,
  mergeWithNext,
  removeChapters,
  renumberTitles,
  replaceInTitles,
  shiftChapters,
  splitChapterAt,
  toDraft,
  validateChapters,
  type DraftChapter,
} from '../chapter-edit'

function draftOf(...rows: Array<[string, number]>): DraftChapter[] {
  return toDraft(rows.map(([title, startMs]) => ({ title, startMs })))
}

function plain(draft: readonly DraftChapter[]) {
  return fromDraft(draft)
}

const all = (draft: readonly DraftChapter[]) => new Set(draft.map((chapter) => chapter.key))

describe('validateChapters', () => {
  it('reports the save-blocking problems the server would refuse', () => {
    const draft = draftOf(['', 5_000], ['B', 4_000], ['C', 90_000])

    expect(validateChapters(draft, 60_000).map(({ index, code, severity }) => ({ index, code, severity }))).toEqual([
      { index: 0, code: 'emptyTitle', severity: 'error' },
      { index: 0, code: 'firstNotZero', severity: 'error' },
      { index: 1, code: 'notAscending', severity: 'error' },
      { index: 2, code: 'pastEnd', severity: 'error' },
    ])
  })

  it('warns, without blocking, about a chapter under a second long', () => {
    const issues = validateChapters(draftOf(['A', 0], ['B', 500], ['C', 10_000]), 20_000)

    expect(issues).toEqual([expect.objectContaining({ index: 0, code: 'tooShort', severity: 'warning' })])
  })

  it('accepts a clean list', () => {
    expect(validateChapters(draftOf(['A', 0], ['B', 10_000]), 20_000)).toEqual([])
  })
})

describe('structural edits', () => {
  it('inserts halfway to the next boundary, or halfway to the end after the last row', () => {
    const draft = draftOf(['A', 0], ['B', 10_000])

    expect(plain(insertChapterAfter(draft, 0, 'New', 20_000).draft)).toEqual([
      { title: 'A', startMs: 0 },
      { title: 'New', startMs: 5_000 },
      { title: 'B', startMs: 10_000 },
    ])
    expect(insertChapterAfter(draft, 1, 'Tail', 20_000).draft.at(-1)).toMatchObject({ title: 'Tail', startMs: 15_000 })
  })

  it('splits the chapter under a position but never on an existing boundary', () => {
    const draft = draftOf(['A', 0], ['B', 10_000])

    expect(plain(splitChapterAt(draft, 4_321, 'Split')!.draft)).toEqual([
      { title: 'A', startMs: 0 },
      { title: 'Split', startMs: 4_321 },
      { title: 'B', startMs: 10_000 },
    ])
    expect(splitChapterAt(draft, 10_000, 'Split')).toBeNull()
  })

  it('merges with the next row and never removes the last remaining chapter', () => {
    const draft = draftOf(['A', 0], ['B', 10_000], ['C', 20_000])

    expect(plain(mergeWithNext(draft, 0))).toEqual([
      { title: 'A', startMs: 0 },
      { title: 'C', startMs: 20_000 },
    ])
    expect(removeChapters(draft, all(draft))).toHaveLength(3)
    expect(removeChapters(draft, new Set([draft[1]!.key]))).toHaveLength(2)
  })

  it('keeps the book starting at 0 when the first chapter is removed', () => {
    const draft = draftOf(['Opening Credits', 0], ['Part One', 35_435], ['Chapter 1', 42_310])

    const next = removeChapters(draft, new Set([draft[0]!.key, draft[1]!.key]))

    expect(next).toEqual([{ ...draft[2]!, startMs: 0 }])
    expect(validateChapters(next, 60_000)).toEqual([])
  })

  it('finds the chapter a time falls in', () => {
    const draft = draftOf(['A', 0], ['B', 10_000])

    expect(indexAtTime(draft, 9_999)).toBe(0)
    expect(indexAtTime(draft, 10_000)).toBe(1)
  })
})

describe('shiftChapters', () => {
  it('moves the chosen rows but keeps the book starting at 0, clamped to the runtime', () => {
    const draft = draftOf(['A', 0], ['B', 10_000], ['C', 19_000])

    expect(plain(shiftChapters(draft, 4_040, all(draft), 20_000))).toEqual([
      { title: 'A', startMs: 0 },
      { title: 'B', startMs: 14_040 },
      { title: 'C', startMs: 19_999 },
    ])
    expect(plain(shiftChapters(draft, -15_000, new Set([draft[1]!.key]), 20_000))[1]).toEqual({ title: 'B', startMs: 0 })
  })
})

describe('title tools', () => {
  it('renumbers with a pattern, a start and padding', () => {
    const draft = draftOf(['x', 0], ['y', 1_000], ['z', 2_000])
    const keys = new Set([draft[1]!.key, draft[2]!.key])

    expect(plain(renumberTitles(draft, keys, 'Chapter {n}', 9, 2)).map((chapter) => chapter.title)).toEqual(['x', 'Chapter 09', 'Chapter 10'])
    expect(plain(renumberTitles(draft, keys, 'Part', 1, 0)).map((chapter) => chapter.title)).toEqual(['x', 'Part 1', 'Part 2'])
  })

  it('finds and replaces as text or as a pattern, and rejects a broken pattern', () => {
    const draft = draftOf(['Track 01 (a)', 0], ['TRACK 02', 1_000])

    expect(replaceInTitles(draft, all(draft), '(a)', '', { regex: false, caseSensitive: true }).changed).toBe(1)
    expect(plain(replaceInTitles(draft, all(draft), '^track (\\d+).*$', 'Chapter $1', { regex: true, caseSensitive: false }).draft)).toEqual([
      { title: 'Chapter 01', startMs: 0 },
      { title: 'Chapter 02', startMs: 1_000 },
    ])
    expect(() => replaceInTitles(draft, all(draft), '(', '', { regex: true, caseSensitive: false })).toThrow(InvalidPatternError)
  })

  it.each([
    ['01 - Breakwater.mp3', 'Breakwater'],
    ['Track 03 - Open Water', 'Open Water'],
    ['003_The_Door', 'The Door'],
    ['12. Epilogue', 'Epilogue'],
    ['Part 1: The Door', 'Part 1: The Door'],
    ['1: Stormblessed', '1: Stormblessed'],
    ['Chapter 1', 'Chapter 1'],
    ['  Too   many  spaces ', 'Too many spaces'],
    ['01 - ', '01 -'],
  ])('cleans %j to %j', (input, expected) => {
    expect(cleanTitle(input)).toBe(expected)
  })

  it('counts only the titles it changed', () => {
    const draft = draftOf(['01 - One', 0], ['Two', 1_000])

    expect(cleanTitles(draft, all(draft)).changed).toBe(1)
  })

  it('folds short chapters into the one before', () => {
    const draft = draftOf(['A', 0], ['blip', 10_000], ['B', 10_400])

    expect(plain(mergeShortChapters(draft, 1_000, 30_000).draft)).toEqual([
      { title: 'A', startMs: 0 },
      { title: 'B', startMs: 10_400 },
    ])
  })
})

describe('chapters from tracks', () => {
  it('names one chapter per track after its file, and gives up on an unknown start', () => {
    expect(
      chaptersFromTracks([
        { name: 'Part 1.mp3', startMs: 0 },
        { name: 'Part 2.mp3', startMs: 60_000 },
      ]),
    ).toEqual([
      { title: 'Part 1', startMs: 0 },
      { title: 'Part 2', startMs: 60_000 },
    ])
    expect(
      chaptersFromTracks([
        { name: 'a.mp3', startMs: 0 },
        { name: 'b.mp3', startMs: null },
      ]),
    ).toBeNull()
  })
})

describe('Chapter editor limit and replacement regressions', () => {
  it('reports oversized chapter lists and titles before save', () => {
    const rows = toDraft(Array.from({ length: 2001 }, (_, index) => ({ title: index === 0 ? 'x'.repeat(501) : 'Title', startMs: index * 2000 })))
    expect(validateChapters(rows, null).map((issue) => issue.code)).toContain('tooMany')
    expect(validateChapters(rows, null).map((issue) => issue.code)).toContain('titleTooLong')
  })
  it.each([1.5, Number.MAX_SAFE_INTEGER])('rejects an unsafe counter %s', (start) => {
    const rows = draftOf(['One', 0], ['Two', 5000])
    expect(() => renumberTitles(rows, all(rows), '{n}', start, 0)).toThrow(RangeError)
  })
  it('treats replacement dollar tokens literally outside regex mode', () => {
    const rows = draftOf(['Ch', 0])
    const next = replaceInTitles(rows, all(rows), 'Ch', '$&apter', { regex: false, caseSensitive: true })
    expect(next.draft[0].title).toBe('$&apter')
  })
})
