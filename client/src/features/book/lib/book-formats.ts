import {
  bookFormatKey,
  formatKeyRank,
  formatOfKey,
  isAudioFormat,
  isBookFormat,
  isContentBookFile,
  isReadAlongFormatKey,
  normalizeFormatPriority,
  type BookFileRef,
} from '@bookorbit/types'

import { i18n } from '@/i18n'
import { hasReadAlong } from './file-capabilities'

type FormatFile = Pick<BookFileRef, 'id' | 'format' | 'role' | 'sizeBytes' | 'mediaOverlay'>

export type BookFormatEntry<T extends FormatFile = FormatFile> = {
  /** `epub:readalong` or the format: what the entry ranks, colours and is labelled by. */
  key: string
  readAlong: boolean
  audio: boolean
  primary: boolean
  /** Source order; for an audiobook, its tracks in play order. */
  files: T[]
  sizeBytes: number
}

export function fileFormatKey(file: Pick<BookFileRef, 'format' | 'mediaOverlay'>): string | null {
  return file.format ? bookFormatKey(file.format, hasReadAlong(file)) : null
}

/**
 * A book's editions, the one list every format chip, edition row and format menu is built from:
 * content files only, a read-along EPUB apart from a plain one, an audiobook's tracks as one entry,
 * the primary first and the rest in the library's priority. Without a priority the source order is
 * kept, which for cards is the order the server already ranked them in.
 */
export function bookFormatEntries<T extends FormatFile>(files: readonly T[], formatPriority?: readonly string[] | null): BookFormatEntry<T>[] {
  const groups = new Map<string, { entry: BookFormatEntry<T>; firstIndex: number }>()

  files.forEach((file, index) => {
    if (!isContentBookFile(file)) return
    const audio = isAudioFormat(file.format!)
    const groupKey = audio ? 'audio' : fileFormatKey(file)!
    const existing = groups.get(groupKey)
    if (existing) {
      existing.entry.files.push(file)
      existing.entry.sizeBytes += file.sizeBytes ?? 0
      existing.entry.primary ||= file.role === 'primary'
      return
    }
    const key = audio ? file.format!.toLowerCase() : groupKey
    groups.set(groupKey, {
      firstIndex: index,
      entry: {
        key,
        readAlong: isReadAlongFormatKey(key),
        audio,
        primary: file.role === 'primary',
        files: [file],
        sizeBytes: file.sizeBytes ?? 0,
      },
    })
  })

  const priority = formatPriority ? normalizeFormatPriority(formatPriority) : null
  return [...groups.values()]
    .sort((a, b) => {
      if (a.entry.primary !== b.entry.primary) return a.entry.primary ? -1 : 1
      if (priority) {
        const rank = formatKeyRank(a.entry.key, priority) - formatKeyRank(b.entry.key, priority)
        if (rank !== 0) return rank
      }
      return a.firstIndex - b.firstIndex
    })
    .map((group) => group.entry)
}

/** Every content file in edition order: what a Read, Download or Send menu lists. */
export function rankedContentFiles<T extends FormatFile>(files: readonly T[], formatPriority?: readonly string[] | null): T[] {
  return bookFormatEntries(files, formatPriority).flatMap((entry) => entry.files)
}

/** The short code a chip shows. A read-along EPUB is `EPUB`; its headphones tell it apart. */
export function formatKeyCode(key: string): string {
  return formatOfKey(key).toUpperCase()
}

/** The translated name of a format, such as "EPUB e-book" or "Read-along EPUB". */
export function formatKeyName(key: string): string {
  if (isReadAlongFormatKey(key)) return i18n.global.t('book.formats.readAlong')
  const format = key.toLowerCase()
  return isBookFormat(format) ? i18n.global.t(`book.formats.${format}`) : formatKeyCode(key)
}
