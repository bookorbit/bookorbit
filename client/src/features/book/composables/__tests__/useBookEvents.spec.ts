import { EventEmitter } from 'events'
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { toast } from 'vue-sonner'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
// vi.mock factories are hoisted before any const/let, so all references inside
// must be self-contained (no outer variables).

const mockSocket = new EventEmitter()

vi.mock('@/features/scanner/composables/useScanProgress', () => ({
  getSocket: () => mockSocket,
}))

vi.mock('vue-sonner', () => ({
  toast: { warning: vi.fn() },
}))

// Import the composable after mocks are in place.
import { useBookEvents } from '@/features/book/composables/useBookEvents'

// Shorthand to the hoisted mock fn — accessed via vi.mocked after module loads.
const toastWarning = vi.mocked(toast.warning)

beforeAll(() => {
  useBookEvents() // triggers ensureInitialized(), registers socket listeners
})

beforeEach(() => {
  vi.useFakeTimers()
  toastWarning.mockClear()
  vi.clearAllTimers()
})

afterEach(() => {
  vi.runAllTimers()
  vi.useRealTimers()
})

// ── onBookMissing ──────────────────────────────────────────────────────────────

describe('onBookMissing', () => {
  it('fires the callback with the bookIds array on book:missing event', () => {
    const { onBookMissing } = useBookEvents()
    const cb = vi.fn()
    const cleanup = onBookMissing(cb)

    mockSocket.emit('book:missing', { libraryId: 1, bookIds: [10, 20, 30] })

    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith([10, 20, 30])
    cleanup()
  })

  it('cleanup function deregisters the callback', () => {
    const { onBookMissing } = useBookEvents()
    const cb = vi.fn()
    const cleanup = onBookMissing(cb)
    cleanup()

    mockSocket.emit('book:missing', { libraryId: 1, bookIds: [1] })

    expect(cb).not.toHaveBeenCalled()
  })

  it('shows singular toast for 1 missing book after 1s debounce', () => {
    const { onBookMissing } = useBookEvents()
    const cleanup = onBookMissing(() => {})

    mockSocket.emit('book:missing', { libraryId: 1, bookIds: [99] })
    expect(toastWarning).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1000)

    expect(toastWarning).toHaveBeenCalledTimes(1)
    expect(toastWarning).toHaveBeenCalledWith('1 book is no longer available on disk.')
    cleanup()
  })

  it('batches multiple events into one toast with the total count', () => {
    const { onBookMissing } = useBookEvents()
    const cleanup = onBookMissing(() => {})

    mockSocket.emit('book:missing', { libraryId: 1, bookIds: [1, 2, 3] })
    mockSocket.emit('book:missing', { libraryId: 1, bookIds: [4, 5] })

    expect(toastWarning).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1000)

    expect(toastWarning).toHaveBeenCalledTimes(1)
    expect(toastWarning).toHaveBeenCalledWith('5 books are no longer available on disk.')
    cleanup()
  })
})

// ── onBookFileRemoved ──────────────────────────────────────────────────────────

describe('onBookFileRemoved', () => {
  it('fires the callback with bookId and fileId on book:file:removed event', () => {
    const { onBookFileRemoved } = useBookEvents()
    const cb = vi.fn()
    const cleanup = onBookFileRemoved(cb)

    mockSocket.emit('book:file:removed', { libraryId: 1, bookId: 42, fileId: 7 })

    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith(42, 7)
    cleanup()
  })

  it('cleanup deregisters the callback', () => {
    const { onBookFileRemoved } = useBookEvents()
    const cb = vi.fn()
    const cleanup = onBookFileRemoved(cb)
    cleanup()

    mockSocket.emit('book:file:removed', { libraryId: 1, bookId: 1, fileId: 1 })

    expect(cb).not.toHaveBeenCalled()
  })
})
