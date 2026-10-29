// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { ChapterPauseWindow, ChapterWaveform } from '@bookorbit/types'
import type { AnalyzePauses } from '../../lib/chapter-snap'
import { useChapterWaveform, WAVEFORM_BUCKETS, WAVEFORM_NARROW_WINDOW_MS, WAVEFORM_WINDOW_MS, type LoadWaveform } from '../useChapterWaveform'

const HALF = WAVEFORM_WINDOW_MS / 2
/** A start this far inside the window keeps it (KEEP_MARGIN in the composable). */
const MARGIN = WAVEFORM_WINDOW_MS * 0.2

function waveformAround(atMs: number, windowMs: number, overrides: Partial<ChapterWaveform> = {}): ChapterWaveform {
  return { fromMs: atMs - windowMs / 2, toMs: atMs + windowMs / 2, peaks: [0.1, 0.6, 0.2], failed: false, ...overrides }
}

function pausesAround(points: number[], windowMs: number): ChapterPauseWindow[] {
  return points.map((pointMs) => ({
    pointMs,
    fromMs: pointMs - windowMs / 2,
    toMs: pointMs + windowMs / 2,
    pauses: [{ startMs: pointMs - 400, endMs: pointMs + 600 }],
    failed: false,
  }))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function setup(load?: LoadWaveform, analyze?: AnalyzePauses, windowMs?: () => number) {
  const loadFn = vi.fn<LoadWaveform>(load ?? (async (atMs, span) => waveformAround(atMs, span)))
  const analyzeFn = vi.fn<AnalyzePauses>(analyze ?? (async (points, span) => pausesAround(points, span)))
  return { load: loadFn, analyze: analyzeFn, waveform: useChapterWaveform(loadFn, analyzeFn, windowMs) }
}

describe('useChapterWaveform', () => {
  it('loads the peaks and the pauses around a start', async () => {
    const { load, analyze, waveform } = setup()

    await waveform.show(60_000)

    expect(load).toHaveBeenCalledWith(60_000, WAVEFORM_WINDOW_MS, WAVEFORM_BUCKETS, expect.any(AbortSignal))
    expect(analyze).toHaveBeenCalledWith([60_000], WAVEFORM_WINDOW_MS, expect.any(AbortSignal))
    expect(waveform.view.value?.waveform).toMatchObject({ fromMs: 60_000 - HALF, toMs: 60_000 + HALF })
    expect(waveform.view.value?.pauses).toEqual([{ startMs: 59_600, endMs: 60_600 }])
    expect(waveform.loading.value).toBe(false)
    expect(waveform.failed.value).toBe(false)
  })

  it('rounds the point it listens at and never asks for pauses before the book starts', async () => {
    const { load, analyze, waveform } = setup()

    await waveform.show(-250.4)

    expect(load).toHaveBeenCalledWith(-250, WAVEFORM_WINDOW_MS, WAVEFORM_BUCKETS, expect.any(AbortSignal))
    expect(analyze).toHaveBeenCalledWith([0], WAVEFORM_WINDOW_MS, expect.any(AbortSignal))
  })

  it('keeps the drawn window while a start stays in its middle', async () => {
    const { load, waveform } = setup()
    await waveform.show(60_000)

    // A start anywhere in the middle 60% of the window keeps it.
    await waveform.show(60_000 - HALF + MARGIN)
    await waveform.show(60_000 + HALF - MARGIN)
    await waveform.show(61_000)

    expect(load).toHaveBeenCalledTimes(1)
    expect(waveform.view.value?.waveform.fromMs).toBe(60_000 - HALF)
  })

  it('listens again when a start nears either edge of the window', async () => {
    const { load, waveform } = setup()
    await waveform.show(60_000)

    const nearEdge = 60_000 + HALF - MARGIN + 1_000
    await waveform.show(nearEdge)
    expect(load).toHaveBeenCalledTimes(2)
    expect(waveform.view.value?.waveform).toMatchObject({ fromMs: nearEdge - HALF, toMs: nearEdge + HALF })

    // The new window's middle starts a second past the old start.
    await waveform.show(59_000)
    expect(load).toHaveBeenCalledTimes(3)
    expect(load).toHaveBeenLastCalledWith(59_000, WAVEFORM_WINDOW_MS, WAVEFORM_BUCKETS, expect.any(AbortSignal))
  })

  it('listens again inside the window when forced', async () => {
    const { load, analyze, waveform } = setup()
    await waveform.show(60_000)

    await waveform.show(60_000, { force: true })

    expect(load).toHaveBeenCalledTimes(2)
    expect(analyze).toHaveBeenCalledTimes(2)
  })

  it('drops an answer for a window that is no longer wanted', async () => {
    const first = deferred<ChapterWaveform>()
    const second = deferred<ChapterWaveform>()
    const pending = [first, second]
    const { waveform } = setup(() => pending.shift()!.promise)

    const firstShow = waveform.show(60_000)
    const secondShow = waveform.show(120_000)

    first.resolve(waveformAround(60_000, WAVEFORM_WINDOW_MS))
    await firstShow
    expect(waveform.view.value).toBeNull()
    expect(waveform.loading.value).toBe(true)

    second.resolve(waveformAround(120_000, WAVEFORM_WINDOW_MS))
    await secondShow
    expect(waveform.view.value?.waveform).toMatchObject({ fromMs: 120_000 - HALF, toMs: 120_000 + HALF })
    expect(waveform.loading.value).toBe(false)
  })

  it('drops a stale failure too', async () => {
    const first = deferred<ChapterWaveform>()
    const pending = [first.promise, Promise.resolve(waveformAround(120_000, WAVEFORM_WINDOW_MS))]
    const { waveform } = setup(() => pending.shift()!)

    const firstShow = waveform.show(60_000)
    await waveform.show(120_000)
    first.reject(new Error('gone'))
    await firstShow

    expect(waveform.failed.value).toBe(false)
    expect(waveform.view.value?.waveform.fromMs).toBe(120_000 - HALF)
  })

  it('marks a waveform the server could not decode as failed and listens again next time', async () => {
    const { load, waveform } = setup(async (atMs, windowMs) => waveformAround(atMs, windowMs, { peaks: [], failed: true }))

    await waveform.show(60_000)

    expect(waveform.failed.value).toBe(true)
    expect(waveform.view.value?.waveform.failed).toBe(true)

    await waveform.show(60_000)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('draws no pauses when the pause analysis failed', async () => {
    const { waveform } = setup(undefined, async (points, windowMs) => pausesAround(points, windowMs).map((window) => ({ ...window, failed: true })))

    await waveform.show(60_000)

    expect(waveform.view.value?.pauses).toEqual([])
    expect(waveform.failed.value).toBe(false)
  })

  it('marks a rejected request as failed and forgets the old window', async () => {
    let fail = false
    const { waveform } = setup(async (atMs, windowMs) => {
      if (fail) throw new Error('network')
      return waveformAround(atMs, windowMs)
    })
    await waveform.show(60_000)

    fail = true
    await waveform.show(200_000)

    expect(waveform.view.value).toBeNull()
    expect(waveform.failed.value).toBe(true)
    expect(waveform.loading.value).toBe(false)
  })

  it('clears what is drawn and ignores a request still in flight', async () => {
    const pending = deferred<ChapterWaveform>()
    const { load, waveform } = setup(async (atMs, windowMs) => waveformAround(atMs, windowMs))
    await waveform.show(60_000)
    load.mockImplementationOnce(() => pending.promise)

    const inFlight = waveform.show(200_000)
    expect(waveform.loading.value).toBe(true)
    waveform.clear()
    expect(load.mock.calls.at(-1)![3]?.aborted).toBe(true)

    expect(waveform.view.value).toBeNull()
    expect(waveform.loading.value).toBe(false)
    expect(waveform.failed.value).toBe(false)

    pending.resolve(waveformAround(200_000, WAVEFORM_WINDOW_MS))
    await inFlight
    expect(waveform.view.value).toBeNull()
    expect(waveform.loading.value).toBe(false)
  })

  it('listens again after a clear even for a start inside the old window', async () => {
    const { load, waveform } = setup()
    await waveform.show(60_000)

    waveform.clear()
    await waveform.show(60_000)

    expect(load).toHaveBeenCalledTimes(2)
    expect(waveform.view.value).not.toBeNull()
  })

  it('asks for a shorter window, with as many buckets per second, when the strip is narrow', async () => {
    const { load, analyze, waveform } = setup(undefined, undefined, () => WAVEFORM_NARROW_WINDOW_MS)

    await waveform.show(60_000)

    expect(load).toHaveBeenCalledWith(60_000, WAVEFORM_NARROW_WINDOW_MS, 350, expect.any(AbortSignal))
    expect(analyze).toHaveBeenCalledWith([60_000], WAVEFORM_NARROW_WINDOW_MS, expect.any(AbortSignal))
  })

  it('pages ahead of a playing playhead near the end of the window, with the playhead near the new start', async () => {
    const { load, waveform } = setup()
    await waveform.show(60_000)

    waveform.follow(60_000 + HALF * 0.7)
    expect(load).toHaveBeenCalledTimes(1)

    const near = 60_000 + HALF - WAVEFORM_WINDOW_MS * 0.05
    waveform.follow(near)
    await vi.waitFor(() => expect(waveform.loading.value).toBe(false))

    expect(load).toHaveBeenCalledTimes(2)
    expect(load.mock.calls[1]![0]).toBe(Math.round(near + WAVEFORM_WINDOW_MS * 0.4))
    expect(waveform.view.value?.waveform.fromMs).toBeCloseTo(near - WAVEFORM_WINDOW_MS * 0.1)
  })

  it('pages back to a playhead that skipped before the window', async () => {
    const { load, waveform } = setup()
    await waveform.show(60_000)

    waveform.follow(30_000)

    expect(load).toHaveBeenLastCalledWith(30_000 + WAVEFORM_WINDOW_MS * 0.4, WAVEFORM_WINDOW_MS, WAVEFORM_BUCKETS, expect.any(AbortSignal))
  })

  it('asks once for a page while it loads, and never again for a window that failed', async () => {
    const pending = deferred<ChapterWaveform>()
    const { load, waveform } = setup(async (atMs, span) => (atMs > 70_000 ? pending.promise : waveformAround(atMs, span)))
    await waveform.show(60_000)

    waveform.follow(71_000)
    waveform.follow(71_500)
    waveform.follow(72_000)
    expect(load).toHaveBeenCalledTimes(2)

    pending.reject(new Error('gone'))
    await vi.waitFor(() => expect(waveform.loading.value).toBe(false))
    waveform.follow(72_100)
    expect(load).toHaveBeenCalledTimes(2)
  })
})
