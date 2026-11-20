import type { AudioCoverEmbedCode, BookDetail } from '@bookorbit/types'
import { hasReadAlong } from './file-capabilities'

type EmbedBook = Pick<BookDetail, 'files' | 'covers'>

/**
 * Whether the book has an audiobook cover to write and a read-along EPUB to write it into. A book
 * with only a read-along EPUB is the case it exists for, since no audio file can carry that cover.
 */
export function canEmbedAudioCover(book: EmbedBook): boolean {
  return book.covers.audio !== null && book.files.some((file) => (file.role === 'content' || file.role === 'primary') && hasReadAlong(file))
}

export function audioCoverEmbedMessageKey(code: AudioCoverEmbedCode): string {
  return `book.audioCoverEmbed.results.${code}`
}

/** What a result is announced as: a cover that was already there is news, not a warning. */
export function audioCoverEmbedTone(code: AudioCoverEmbedCode): 'success' | 'info' | 'warning' | 'error' {
  if (code === 'embedded') return 'success'
  if (code === 'unchanged') return 'info'
  return code === 'failed' ? 'error' : 'warning'
}
