import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import type { BookMergedEvent } from '@bookorbit/types'

const mocks = vi.hoisted(() => ({
  refreshLibraries: vi.fn<() => Promise<void>>(),
  refreshCounts: vi.fn<() => Promise<void>>(),
  stop: vi.fn<() => void>(),
  listener: null as ((event: BookMergedEvent) => void) | null,
}))

vi.mock('../useLibraries', () => ({ useLibraries: () => ({ refreshLibraries: mocks.refreshLibraries }) }))
vi.mock('@/composables/useBrowseCounts', () => ({ useBrowseCounts: () => ({ refreshCounts: mocks.refreshCounts }) }))
vi.mock('@/features/book/composables/useBookEvents', () => ({
  useBookEvents: () => ({
    onBookMerged: (cb: (event: BookMergedEvent) => void) => {
      mocks.listener = cb
      return mocks.stop
    },
  }),
}))

const { useLibraryMergeRefresh } = await import('../useLibraryMergeRefresh')

const merged = { targetBookId: 1, sourceBookIds: [2], libraryId: 3 } as unknown as BookMergedEvent

beforeEach(() => {
  vi.useFakeTimers()
  mocks.refreshLibraries.mockReset().mockResolvedValue(undefined)
  mocks.refreshCounts.mockReset().mockResolvedValue(undefined)
  mocks.stop.mockReset()
  mocks.listener = null
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useLibraryMergeRefresh', () => {
  it('refreshes the library list and Browse counts once after a burst of merges', () => {
    const scope = effectScope()
    scope.run(() => useLibraryMergeRefresh())

    mocks.listener?.(merged)
    mocks.listener?.(merged)
    expect(mocks.refreshLibraries).not.toHaveBeenCalled()

    vi.advanceTimersByTime(500)
    expect(mocks.refreshLibraries).toHaveBeenCalledOnce()
    expect(mocks.refreshCounts).toHaveBeenCalledOnce()
    scope.stop()
  })

  it('stops listening and drops a pending refresh when its scope ends', () => {
    const scope = effectScope()
    scope.run(() => useLibraryMergeRefresh())

    mocks.listener?.(merged)
    scope.stop()
    vi.advanceTimersByTime(500)

    expect(mocks.stop).toHaveBeenCalledOnce()
    expect(mocks.refreshLibraries).not.toHaveBeenCalled()
  })
})
