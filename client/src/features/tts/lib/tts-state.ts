import type { TtsPlaybackState } from '@bookorbit/types'

export interface TtsCurrentBook {
  bookId: number
  bookFileId: number
  title: string
  author: string | null
  coverUrl: string | null
  totalChapters: number
}

export interface TtsPlayerState {
  playbackState: TtsPlaybackState
  currentBook: TtsCurrentBook | null
  currentBlockIndex: number
  currentChapterIndex: number
  speed: number
  error: string | null
}
