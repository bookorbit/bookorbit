import type { BookFileRef } from '@bookorbit/types'

export type ReadAlongFile = Pick<BookFileRef, 'format' | 'mediaOverlay'> | null | undefined

export function hasReadAlong(file: ReadAlongFile): boolean {
  return file?.format?.toLowerCase() === 'epub' && file.mediaOverlay?.available === true
}
