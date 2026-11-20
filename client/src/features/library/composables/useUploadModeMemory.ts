/** How a library upload adds its files: through the library's dock for review, or straight in. */
export type LibraryUploadMode = 'review' | 'now'

const KEY_PREFIX = 'bookorbit:library-upload-mode'

function storageKey(userId: number | null, libraryId: number): string {
  return `${KEY_PREFIX}:${userId ?? 'anonymous'}:${libraryId}`
}

/**
 * The last choice per person per library (P6). User preferences hold fixed, typed keys only, so this
 * lives in the browser; storage that is blocked or full just means the default is offered again.
 */
export function readUploadMode(userId: number | null, libraryId: number): LibraryUploadMode | null {
  try {
    const value = localStorage.getItem(storageKey(userId, libraryId))
    return value === 'review' || value === 'now' ? value : null
  } catch {
    return null
  }
}

export function rememberUploadMode(userId: number | null, libraryId: number, mode: LibraryUploadMode): void {
  try {
    localStorage.setItem(storageKey(userId, libraryId), mode)
  } catch {
    // Remembering is a convenience; the upload itself already went ahead.
  }
}
