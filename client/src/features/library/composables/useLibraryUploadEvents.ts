export interface LibraryUploadCompletedEvent {
  libraryId: number
  uploadedBookIds: number[]
  uploadedCount: number
  failedCount: number
  attemptedCount: number
}

type LibraryUploadCompletedCallback = (event: LibraryUploadCompletedEvent) => void

const completedCallbacks = new Set<LibraryUploadCompletedCallback>()

export function emitLibraryUploadCompleted(event: LibraryUploadCompletedEvent): void {
  for (const cb of completedCallbacks) cb(event)
}

export function useLibraryUploadEvents() {
  function onLibraryUploadCompleted(cb: LibraryUploadCompletedCallback): () => void {
    completedCallbacks.add(cb)
    return () => completedCallbacks.delete(cb)
  }

  return { onLibraryUploadCompleted }
}
