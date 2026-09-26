// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PodcastImportProgressEvent } from '@bookorbit/types'

const listeners: Array<(event: PodcastImportProgressEvent) => void> = []
const subscribeLibrary = vi.fn<() => void>()
const onShowDiscovered = vi.fn<() => void>()

vi.mock('./usePodcastEvents', () => ({
  usePodcastEvents: () => ({
    subscribeLibrary,
    onShowDiscovered,
    onImportProgress: (callback: (event: PodcastImportProgressEvent) => void) => {
      listeners.push(callback)
      return () => undefined
    },
  }),
}))

const { usePodcastImportProgress } = await import('./usePodcastImportProgress')

function emit(overrides: Partial<PodcastImportProgressEvent> = {}) {
  const event: PodcastImportProgressEvent = {
    libraryId: 13,
    kind: 'local_files',
    queued: 0,
    processing: 1,
    failed: 0,
    processed: 25,
    total: 100,
    ...overrides,
  }
  for (const listener of listeners) listener(event)
}

describe('usePodcastImportProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Drain any state a previous test left in the module-level map.
    emit({ queued: 0, processing: 0, failed: 0 })
    vi.advanceTimersByTime(5_000)
  })

  it('reports a running local import as a percentage', () => {
    const progress = usePodcastImportProgress()
    emit()

    expect(progress.isImporting(13)).toBe(true)
    expect(progress.importPct(13)).toBe(25)
    expect(progress.importBarWidth(13)).toBe('25%')
  })

  it('shows an indeterminate bar while the run is still counting', () => {
    const progress = usePodcastImportProgress()
    emit({ total: null, processed: 0 })

    expect(progress.importPct(13)).toBe(0)
    expect(progress.importBarWidth(13)).toBe('30%')
  })

  it('ignores the OPML lane, whose totals describe different work', () => {
    const progress = usePodcastImportProgress()
    emit({ kind: 'opml', processed: 9, total: 9 })

    expect(progress.getImport(13)).toBeNull()
  })

  it('keeps the finished readout briefly, then drops it', () => {
    const progress = usePodcastImportProgress()
    emit()
    emit({ queued: 0, processing: 0, processed: 100, total: 100 })

    expect(progress.isImporting(13)).toBe(false)
    expect(progress.getImport(13)).toMatchObject({ processed: 100, active: false })

    vi.advanceTimersByTime(3_100)
    expect(progress.getImport(13)).toBeNull()
  })

  it('cancels the settle timer when more work arrives', () => {
    const progress = usePodcastImportProgress()
    emit({ queued: 0, processing: 0, processed: 100, total: 100 })
    emit({ queued: 2, processing: 1, processed: 100, total: 400 })

    vi.advanceTimersByTime(3_100)
    expect(progress.isImporting(13)).toBe(true)
    expect(progress.importPct(13)).toBe(25)
  })

  it('caps the percentage when more files turn up than were counted', () => {
    const progress = usePodcastImportProgress()
    emit({ processed: 150, total: 100 })

    expect(progress.importPct(13)).toBe(100)
  })
})
