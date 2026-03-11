import { describe, expect, it, vi } from 'vitest'

import { emitLibraryUploadCompleted, useLibraryUploadEvents, type LibraryUploadCompletedEvent } from '../useLibraryUploadEvents'

describe('useLibraryUploadEvents', () => {
  it('notifies subscribers with the emitted event payload', () => {
    const { onLibraryUploadCompleted } = useLibraryUploadEvents()
    const cb = vi.fn<(event: LibraryUploadCompletedEvent) => void>()
    const off = onLibraryUploadCompleted(cb)

    const event = {
      libraryId: 7,
      uploadedBookIds: [101, 102],
      uploadedCount: 2,
      failedCount: 1,
      attemptedCount: 3,
    }

    emitLibraryUploadCompleted(event)

    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith(event)

    off()
  })

  it('stops notifying once unsubscribed', () => {
    const { onLibraryUploadCompleted } = useLibraryUploadEvents()
    const cb = vi.fn<(event: LibraryUploadCompletedEvent) => void>()
    const off = onLibraryUploadCompleted(cb)

    off()

    emitLibraryUploadCompleted({
      libraryId: 5,
      uploadedBookIds: [1],
      uploadedCount: 1,
      failedCount: 0,
      attemptedCount: 1,
    })

    expect(cb).not.toHaveBeenCalled()
  })
})
