import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { LIVE_RECOUNT_INTERVAL_MS, useLibraryContentRefresh } from '../useLibraryContentRefresh'

function setup(initialCount?: number) {
  const libraryId = ref<number | null>(4)
  const bookCount = ref<number | undefined>(initialCount)
  const liveAdded = ref(0)
  const recount = vi.fn<() => void>()
  const reload = vi.fn<() => void>()
  const scope = effectScope()
  scope.run(() => useLibraryContentRefresh({ libraryId, bookCount, liveAdded, recount, reload }))
  return { libraryId, bookCount, liveAdded, recount, reload, scope }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useLibraryContentRefresh', () => {
  it('recounts as books stream in, at most once per interval', async () => {
    const { liveAdded, recount, reload, scope } = setup(0)

    liveAdded.value = 1
    await nextTick()
    vi.advanceTimersByTime(0)
    expect(recount).toHaveBeenCalledOnce()

    liveAdded.value = 3
    await nextTick()
    liveAdded.value = 12
    await nextTick()
    vi.advanceTimersByTime(LIVE_RECOUNT_INTERVAL_MS - 1)
    expect(recount).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(1)
    expect(recount).toHaveBeenCalledTimes(2)
    expect(reload).not.toHaveBeenCalled()
    scope.stop()
  })

  it('recounts and reloads at once when the library list reports a new count', async () => {
    const { bookCount, recount, reload, scope } = setup(0)

    bookCount.value = 12
    await nextTick()
    expect(recount).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledOnce()
    scope.stop()
  })

  it('folds a pending streaming recount into the one a new count triggers', async () => {
    const { liveAdded, bookCount, recount, scope } = setup(0)

    liveAdded.value = 1
    await nextTick()
    vi.advanceTimersByTime(0)
    liveAdded.value = 2
    await nextTick()
    bookCount.value = 2
    await nextTick()
    vi.advanceTimersByTime(LIVE_RECOUNT_INTERVAL_MS)
    expect(recount).toHaveBeenCalledTimes(2)
    scope.stop()
  })

  it('leaves a library switch and the first count to the page that loads them', async () => {
    const { libraryId, bookCount, recount, reload, scope } = setup()

    bookCount.value = 12
    await nextTick()
    libraryId.value = 5
    bookCount.value = 30
    await nextTick()
    expect(recount).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    scope.stop()
  })

  it('drops a pending recount when its scope ends', async () => {
    const { liveAdded, recount, scope } = setup(0)

    liveAdded.value = 1
    await nextTick()
    vi.advanceTimersByTime(0)
    liveAdded.value = 2
    await nextTick()
    scope.stop()
    vi.advanceTimersByTime(LIVE_RECOUNT_INTERVAL_MS)
    expect(recount).toHaveBeenCalledOnce()
  })
})
