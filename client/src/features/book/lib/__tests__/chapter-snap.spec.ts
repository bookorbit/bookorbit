// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { ChapterPause, ChapterPauseWindow } from '@bookorbit/types'
import { fromDraft, toDraft } from '../chapter-edit'
import { fitOffsetToPauses, pauseAnchor, pickPause, snapToPauses, snapWindowMs, type AnalyzePauses, type SnapProgress } from '../chapter-snap'

function pause(startMs: number, endMs: number): ChapterPause {
  return { startMs, endMs }
}

/** A fake server: answers every point with the pauses of one fixed recording that fall in its window. */
function analyzeFrom(recording: ChapterPause[], failAt: number[] = []) {
  return vi.fn<AnalyzePauses>(async (points, windowMs) =>
    points.map((pointMs) => {
      const fromMs = Math.max(0, pointMs - windowMs / 2)
      const toMs = pointMs + windowMs / 2
      return {
        pointMs,
        fromMs,
        toMs,
        pauses: recording.filter((candidate) => candidate.endMs > fromMs && candidate.startMs < toMs),
        failed: failAt.includes(pointMs),
      } satisfies ChapterPauseWindow
    }),
  )
}

describe('pause choice', () => {
  it('starts a little before speech resumes, or in the middle of a short pause', () => {
    expect(pauseAnchor(pause(1_885_256, 1_888_845), 'end')).toBe(1_888_545)
    expect(pauseAnchor(pause(10_000, 10_400), 'end')).toBe(10_200)
    expect(pauseAnchor(pause(10_000, 12_000), 'middle')).toBe(11_000)
  })

  it('prefers a long pause a little further off over a short one nearby', () => {
    const pauses = [pause(1_885_256, 1_888_845), pause(1_889_571, 1_890_653), pause(1_890_974, 1_893_553)]

    expect(pickPause(1_888_297, pauses, 5_000, 'end')).toBe(1_888_545)
    expect(pickPause(1_890_400, pauses, 5_000, 'end')).toBe(1_888_545)
    expect(pickPause(1_888_297, [pause(1_900_000, 1_903_000)], 5_000, 'end')).toBeNull()
  })

  it('listens a margin beyond the radius, within the server limits', () => {
    expect(snapWindowMs(5_000, false)).toBe(14_000)
    expect(snapWindowMs(5_000, true)).toBe(18_000)
    expect(snapWindowMs(40_000, false)).toBe(60_000)
  })
})

describe('snapToPauses', () => {
  const rows = toDraft([
    { title: 'Opening', startMs: 0 },
    { title: 'One', startMs: 60_000 },
    { title: 'Two', startMs: 120_000 },
    { title: 'Three', startMs: 180_000 },
  ])

  it('moves each start onto its pause and reports what happened', async () => {
    const analyze = analyzeFrom([pause(58_000, 61_000), pause(119_000, 120_500), pause(300_000, 301_000)])

    const outcome = await snapToPauses(
      rows,
      new Set(rows.map((row) => row.key)),
      { radiusMs: 5_000, placement: 'end', progressive: false, totalDurationMs: 400_000 },
      analyze,
    )

    expect(fromDraft(outcome.draft).map((chapter) => chapter.startMs)).toEqual([0, 60_700, 120_200, 180_000])
    expect(outcome).toMatchObject({ snapped: 2, moved: 2, notFound: 1, blocked: 0, failed: 0, meanShiftMs: 450, maxShiftMs: 700 })
    expect(outcome.draft[3]).toBe(rows[3])
    expect(analyze).toHaveBeenCalledWith([60_000, 120_000, 180_000], 14_000, undefined)
  })

  it('carries each correction forward so a drifting list stays inside the search', async () => {
    // Each chapter of the real audio runs 4 s later than the list says, more with every chapter.
    const recording = [pause(62_500, 64_300), pause(126_500, 128_300), pause(190_500, 192_300)]

    const plain = await snapToPauses(
      rows,
      new Set(rows.map((row) => row.key)),
      { radiusMs: 5_000, placement: 'end', progressive: false, totalDurationMs: 400_000 },
      analyzeFrom(recording),
    )
    const carried = await snapToPauses(
      rows,
      new Set(rows.map((row) => row.key)),
      { radiusMs: 5_000, placement: 'end', progressive: true, totalDurationMs: 400_000 },
      analyzeFrom(recording),
    )

    expect(plain.snapped).toBe(1)
    expect(fromDraft(carried.draft).map((chapter) => chapter.startMs)).toEqual([0, 64_000, 128_000, 192_000])
    expect(carried.snapped).toBe(3)
  })

  it('listens again when a correction moves a guess out of the window it was heard in', async () => {
    const analyze = analyzeFrom([pause(62_500, 64_300), pause(126_500, 128_300), pause(190_500, 192_300)])

    await snapToPauses(
      rows,
      new Set(rows.map((row) => row.key)),
      { radiusMs: 5_000, placement: 'end', progressive: true, totalDurationMs: 400_000 },
      analyze,
    )

    expect(analyze.mock.calls.map(([points]) => points)).toEqual([[60_000, 120_000, 180_000], [188_000]])
  })

  it('keeps the first chapter at 0, leaves unchosen rows alone and never reorders', async () => {
    const close = toDraft([
      { title: 'Opening', startMs: 0 },
      { title: 'Part One', startMs: 10_000 },
      { title: 'Chapter 1', startMs: 13_000 },
    ])
    const analyze = analyzeFrom([pause(0, 3_000), pause(11_000, 13_500)])

    const outcome = await snapToPauses(
      close,
      new Set([close[0]!.key, close[1]!.key]),
      { radiusMs: 5_000, placement: 'end', progressive: false, totalDurationMs: 400_000 },
      analyze,
    )

    // The pause for "Part One" ends past "Chapter 1", which is not being moved, so it stays put.
    expect(fromDraft(outcome.draft).map((chapter) => chapter.startMs)).toEqual([0, 10_000, 13_000])
    expect(outcome.blocked).toBe(1)
    expect(analyze).toHaveBeenCalledWith([10_000], 14_000, undefined)
  })

  it('counts audio that would not decode and reports progress per batch', async () => {
    const many = toDraft(Array.from({ length: 31 }, (_, index) => ({ title: `${index}`, startMs: index * 60_000 })))
    const analyze = analyzeFrom([], [60_000])
    const progress = vi.fn<(progress: SnapProgress) => void>()

    const outcome = await snapToPauses(
      many,
      new Set(many.map((row) => row.key)),
      { radiusMs: 5_000, placement: 'end', progressive: false, totalDurationMs: null },
      analyze,
      progress,
    )

    expect(analyze).toHaveBeenCalledTimes(2)
    expect(progress.mock.calls).toEqual([[{ done: 25, total: 30 }], [{ done: 30, total: 30 }]])
    expect(outcome).toMatchObject({ failed: 1, notFound: 29, moved: 0 })
  })

  it('stops between batches once cancelled', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      snapToPauses(
        rows,
        new Set([rows[1]!.key]),
        { radiusMs: 5_000, placement: 'end', progressive: false, totalDurationMs: null },
        analyzeFrom([]),
        undefined,
        controller.signal,
      ),
    ).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})

describe('fitOffsetToPauses', () => {
  it('finds the offset that lands the starts in the pauses, near where a snap would put them', () => {
    // The book drops a 4 s intro: every incoming start is 4.04 s late against the real pauses.
    const starts = [60_000, 300_000, 900_000]
    const windows = starts.map<ChapterPauseWindow>((start) => ({
      pointMs: start,
      fromMs: start - 30_000,
      toMs: start + 30_000,
      pauses: [pause(start - 6_000, start - 3_700), pause(start + 8_000, start + 8_600)],
      failed: false,
    }))

    expect(fitOffsetToPauses(starts, windows)).toEqual({ offsetMs: -4_000, hits: 3, total: 3 })
  })

  it('ignores windows it could not hear and gives up when nothing lands', () => {
    const failed: ChapterPauseWindow = { pointMs: 0, fromMs: 0, toMs: 0, pauses: [], failed: true }

    expect(fitOffsetToPauses([60_000], [failed])).toBeNull()
    expect(fitOffsetToPauses([60_000], [{ ...failed, failed: false }])).toBeNull()
  })
})

it('keeps progressive starts ascending when the following pause lookup fails', async () => {
  const rows = toDraft([
    { title: 'First', startMs: 0 },
    { title: 'Second', startMs: 10000 },
    { title: 'Third', startMs: 13000 },
  ])
  const result = await snapToPauses(
    rows,
    new Set(rows.map((row) => row.key)),
    { radiusMs: 5000, placement: 'end', progressive: true, totalDurationMs: 17000 },
    analyzeFrom([pause(14000, 15300)], [13000]),
  )
  expect(result.draft.every((row, index) => index === 0 || row.startMs > result.draft[index - 1].startMs)).toBe(true)
})
