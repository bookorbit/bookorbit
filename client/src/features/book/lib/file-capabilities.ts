import { isAudioFormat, isContentBookFile, type BookFileRef } from '@bookorbit/types'

export type ReadAlongFile = Pick<BookFileRef, 'format' | 'mediaOverlay'> | null | undefined

export function hasReadAlong(file: ReadAlongFile): boolean {
  return file?.format?.toLowerCase() === 'epub' && file.mediaOverlay?.available === true
}

/** A narrated EPUB edition. Covers and sidecars never count. */
export function hasReadAlongFile(files: readonly Pick<BookFileRef, 'format' | 'role' | 'mediaOverlay'>[]): boolean {
  return files.some((file) => isContentBookFile(file) && hasReadAlong(file))
}

/**
 * Whether any file is audio, the same test the server applies. `audioMetadata` is not this test:
 * it also carries narrators for a book whose only edition is a read-along or plain EPUB.
 */
export function hasAudioFile(files: readonly Pick<BookFileRef, 'format'>[]): boolean {
  return files.some((file) => file.format != null && isAudioFormat(file.format))
}
