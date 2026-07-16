import { EventEmitter } from 'events'
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { toast } from 'vue-sonner'
import type { BookProgressChangedEvent, BookTransferredEvent } from '@bookorbit/types'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
// vi.mock factories are hoisted before any const/let, so all references inside
// must be self-contained (no outer variables).

const mockSocket = new EventEmitter()

vi.mock('@/features/scanner/composables/useScanProgress', () => ({
  getSocket: () => mockSocket,
}))

vi.mock('vue-sonner', () => ({
  toast: {
    warning: vi.fn<(message: string) => void>(),
    success: vi.fn<(message: string) => void>(),
    info: vi.fn<(message: string) => void>(),
  },
}))

// Import the composable after mocks are in place.
import { useBookEvents } from '@/features/book/composables/useBookEvents'

// Shorthand to the hoisted mock fn — accessed via vi.mocked after module loads.
const toastWarning = vi.mocked(toast.warning)
const toastSuccess = vi.mocked(toast.success)
const toastInfo = vi.mocked(toast.info)

beforeAll(() => {
  useBookEvents() // triggers ensureInitialized(), registers socket listeners
})

beforeEach(() => {
  vi.useFakeTimers()
  toastWarning.mockClear()
  toastSuccess.mockClear()
  toastInfo.mockClear()
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
    const cb = vi.fn<(bookIds: number[]) => void>()
    const cleanup = onBookMissing(cb)

    mockSocket.emit('book:missing', { libraryId: 1, bookIds: [10, 20, 30] })

    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith([10, 20, 30])
    cleanup()
  })

  it('cleanup function deregisters the callback', () => {
    const { onBookMissing } = useBookEvents()
    const cb = vi.fn<(bookIds: number[]) => void>()
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

// ── onBookRestored ─────────────────────────────────────────────────────────────

describe('onBookRestored', () => {
  it('fires the callback with the bookIds array on book:restored event', () => {
    const { onBookRestored } = useBookEvents()
    const cb = vi.fn<(bookIds: number[]) => void>()
    const cleanup = onBookRestored(cb)

    mockSocket.emit('book:restored', { libraryId: 1, bookIds: [77] })

    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith([77])
    cleanup()
  })

  it('shows success toast for 1 restored book after 1s debounce', () => {
    const { onBookRestored } = useBookEvents()
    const cleanup = onBookRestored(() => {})

    mockSocket.emit('book:restored', { libraryId: 1, bookIds: [123] })
    expect(toastSuccess).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1000)

    expect(toastSuccess).toHaveBeenCalledTimes(1)
    expect(toastSuccess).toHaveBeenCalledWith('1 book was restored on disk.')
    cleanup()
  })

  it('batches multiple events into one success toast', () => {
    const { onBookRestored } = useBookEvents()
    const cleanup = onBookRestored(() => {})

    mockSocket.emit('book:restored', { libraryId: 1, bookIds: [1, 2] })
    mockSocket.emit('book:restored', { libraryId: 1, bookIds: [3] })

    vi.advanceTimersByTime(1000)

    expect(toastSuccess).toHaveBeenCalledTimes(1)
    expect(toastSuccess).toHaveBeenCalledWith('3 books were restored on disk.')
    cleanup()
  })
})

// ── onBookMoved ───────────────────────────────────────────────────────────────

describe('onBookMoved', () => {
  it('fires the callback with the bookIds array on book:moved event', () => {
    const { onBookMoved } = useBookEvents()
    const cb = vi.fn<(bookIds: number[]) => void>()
    const cleanup = onBookMoved(cb)

    mockSocket.emit('book:moved', { libraryId: 1, bookIds: [44, 45] })

    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith([44, 45])
    cleanup()
  })

  it('shows info toast for moved books after 1s debounce', () => {
    const { onBookMoved } = useBookEvents()
    const cleanup = onBookMoved(() => {})

    mockSocket.emit('book:moved', { libraryId: 1, bookIds: [1] })
    mockSocket.emit('book:moved', { libraryId: 1, bookIds: [2, 3] })

    vi.advanceTimersByTime(1000)

    expect(toastInfo).toHaveBeenCalledTimes(1)
    expect(toastInfo).toHaveBeenCalledWith('3 books were moved to new locations.')
    cleanup()
  })
})

// ── onBookTransferred ─────────────────────────────────────────────────────────

describe('onBookTransferred', () => {
  it('fires the callback with the full transfer event without showing a toast', () => {
    const { onBookTransferred } = useBookEvents()
    const cb = vi.fn<(event: BookTransferredEvent) => void>()
    const cleanup = onBookTransferred(cb)
    const event: BookTransferredEvent = { fromLibraryId: 1, toLibraryId: 2, bookIds: [77] }

    mockSocket.emit('book:transferred', event)
    vi.advanceTimersByTime(1000)

    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith(event)
    expect(toastWarning).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(toastInfo).not.toHaveBeenCalled()
    cleanup()
  })

  it('cleanup function deregisters the transferred callback', () => {
    const { onBookTransferred } = useBookEvents()
    const cb = vi.fn<(event: BookTransferredEvent) => void>()
    const cleanup = onBookTransferred(cb)
    cleanup()

    mockSocket.emit('book:transferred', { fromLibraryId: 1, toLibraryId: 2, bookIds: [77] })

    expect(cb).not.toHaveBeenCalled()
  })

  it('automatically deregisters callbacks registered during component setup on unmount', () => {
    const cb = vi.fn<(event: BookTransferredEvent) => void>()
    const Component = defineComponent({
      setup() {
        useBookEvents().onBookTransferred(cb)
        return () => null
      },
    })

    const wrapper = mount(Component)
    wrapper.unmount()

    mockSocket.emit('book:transferred', { fromLibraryId: 1, toLibraryId: 2, bookIds: [77] })

    expect(cb).not.toHaveBeenCalled()
  })
})

describe('onBookProgressChanged', () => {
  it('fires the callback with the progress event and supports cleanup', () => {
    const { onBookProgressChanged } = useBookEvents()
    const cb = vi.fn<(event: BookProgressChangedEvent) => void>()
    const cleanup = onBookProgressChanged(cb)
    const event: BookProgressChangedEvent = { bookId: 142, progress: 61.02, source: 'koreader' }

    mockSocket.emit('book:progress-changed', event)

    expect(cb).toHaveBeenCalledExactlyOnceWith(event)

    cleanup()
    mockSocket.emit('book:progress-changed', event)
    expect(cb).toHaveBeenCalledOnce()
  })
})
