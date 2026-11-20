import type { BookDetail } from '@bookorbit/types'
import { hasAudioFile, hasReadAlongFile } from './file-capabilities'

export const BOOK_DETAIL_TABS = ['details', 'edit', 'files', 'chapters', 'reading-log', 'highlights'] as const

export type BookDetailTab = (typeof BOOK_DETAIL_TABS)[number]

export function normalizeBookDetailTab(value: unknown): BookDetailTab {
  if (typeof value === 'string' && BOOK_DETAIL_TABS.includes(value as BookDetailTab)) {
    return value as BookDetailTab
  }
  return 'details'
}

/** The Chapters tab has audio files to lay out, or a read-along EPUB whose narration it can list. */
export function hasChaptersTab(book: Pick<BookDetail, 'files'> | null | undefined): boolean {
  if (!book) return false
  return hasAudioFile(book.files) || hasReadAlongFile(book.files)
}
