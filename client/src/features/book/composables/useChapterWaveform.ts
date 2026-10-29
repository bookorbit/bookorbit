import { getCurrentScope, onScopeDispose, ref, shallowRef } from 'vue'
import type { ChapterPause, ChapterWaveform } from '@bookorbit/types'
import type { AnalyzePauses } from '../lib/chapter-snap'

export type LoadWaveform = (atMs: number, windowMs: number, buckets: number, signal?: AbortSignal) => Promise<ChapterWaveform>

export interface WaveformView {
  waveform: ChapterWaveform
  pauses: ChapterPause[]
}

/** Wide enough to show a sentence either side of a cut; 600 is the server's bucket ceiling. */
export const WAVEFORM_WINDOW_MS = 24_000
export const WAVEFORM_BUCKETS = 600
/** A strip too narrow for the full window draws less of it, so a tenth of a second stays visible. */
export const WAVEFORM_NARROW_WINDOW_MS = 14_000

/** A start this far inside the drawn window keeps it; nearer the edge, the window moves to centre it. */
const KEEP_MARGIN = 0.2
/** A playing playhead this near the window's end turns the page. */
const FOLLOW_EDGE = 0.1
/** Where a new page puts the playhead, as a share of the window from its start. */
const FOLLOW_LEAD = 0.1

function bucketsFor(windowMs: number): number {
  return Math.round((WAVEFORM_BUCKETS * windowMs) / WAVEFORM_WINDOW_MS)
}

/**
 * The audio around the boundary being edited, or around a playing playhead: peak levels and the
 * pauses in the same window. Moving a start within the middle of the window keeps what is drawn; a
 * start that leaves it, or a different chapter, listens again. Answers for a window that is no longer
 * wanted are dropped.
 */
export function useChapterWaveform(load: LoadWaveform, analyze: AnalyzePauses, windowMs: () => number = () => WAVEFORM_WINDOW_MS) {
  const view = shallowRef<WaveformView | null>(null)
  const loading = ref(false)
  const failed = ref(false)
  let token = 0
  let controller: AbortController | null = null
  /** The window asked for last, drawn or still loading; following pages from it so it never asks twice. */
  let wanted: { fromMs: number; toMs: number } | null = null
  if (getCurrentScope()) onScopeDispose(clear)

  function covers(atMs: number): boolean {
    const current = view.value?.waveform
    if (!current || current.failed) return false
    const margin = (current.toMs - current.fromMs) * KEEP_MARGIN
    return atMs >= current.fromMs + margin && atMs <= current.toMs - margin
  }

  async function show(atMs: number, options: { force?: boolean } = {}): Promise<void> {
    if (!options.force && covers(atMs)) return
    controller?.abort()
    controller = new AbortController()
    const signal = controller.signal
    const mine = ++token
    const span = windowMs()
    wanted = { fromMs: atMs - span / 2, toMs: atMs + span / 2 }
    loading.value = true
    try {
      const [waveform, windows] = await Promise.all([
        load(Math.round(atMs), span, bucketsFor(span), signal),
        analyze([Math.max(0, Math.round(atMs))], span, signal),
      ])
      if (mine !== token) return
      view.value = { waveform, pauses: windows[0]?.failed ? [] : (windows[0]?.pauses ?? []) }
      failed.value = waveform.failed
    } catch {
      if (mine !== token) return
      view.value = null
      failed.value = true
    } finally {
      if (mine === token) loading.value = false
    }
  }

  /** Keeps a playing playhead in view: near the end of the window, or before it, the next page is drawn with the playhead near its start. */
  function follow(atMs: number): void {
    const span = windowMs()
    if (wanted && atMs >= wanted.fromMs && atMs <= wanted.toMs - span * FOLLOW_EDGE) return
    void show(atMs + span * (0.5 - FOLLOW_LEAD), { force: true })
  }

  function clear(): void {
    controller?.abort()
    controller = null
    token += 1
    wanted = null
    view.value = null
    loading.value = false
    failed.value = false
  }

  return { view, loading, failed, show, follow, clear }
}
