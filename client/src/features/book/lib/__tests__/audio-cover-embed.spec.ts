import { describe, expect, it } from 'vitest'
import type { AudioCoverEmbedCode, BookDetail } from '@bookorbit/types'
import { AUDIO_COVER_EMBED_CODES } from '@bookorbit/types'

import { audioCoverEmbedMessageKey, audioCoverEmbedTone, canEmbedAudioCover } from '../audio-cover-embed'
import en from '@/locales/en.json'

type Book = Pick<BookDetail, 'files' | 'covers'>

const slot = { source: 'custom', updatedAt: '2026-01-01T00:00:00.000Z', width: 500, height: 500 } as const

function file(overrides: Partial<BookDetail['files'][number]> = {}): BookDetail['files'][number] {
  return { id: 1, format: 'epub', role: 'content', mediaOverlay: { available: true }, ...overrides } as BookDetail['files'][number]
}

function book(overrides: Partial<Book> = {}): Book {
  return { files: [file()], covers: { ebook: null, audio: slot }, ...overrides }
}

describe('canEmbedAudioCover', () => {
  it('offers the action to a book with an audiobook cover and a read-along EPUB', () => {
    expect(canEmbedAudioCover(book())).toBe(true)
    expect(canEmbedAudioCover(book({ files: [file({ role: 'primary' })] }))).toBe(true)
  })

  it('offers nothing when there is no audiobook cover to write', () => {
    expect(canEmbedAudioCover(book({ covers: { ebook: slot, audio: null } }))).toBe(false)
  })

  it('offers nothing without a read-along EPUB in the book itself', () => {
    expect(canEmbedAudioCover(book({ files: [file({ mediaOverlay: { available: false } as never })] }))).toBe(false)
    expect(canEmbedAudioCover(book({ files: [file({ mediaOverlay: null })] }))).toBe(false)
    expect(canEmbedAudioCover(book({ files: [file({ format: 'm4b' })] }))).toBe(false)
    expect(canEmbedAudioCover(book({ files: [file({ role: 'supplement' })] }))).toBe(false)
  })
})

describe('audio cover embed copy', () => {
  it.each(AUDIO_COVER_EMBED_CODES)('has English copy for the %s outcome', (code) => {
    const results = en.book.audioCoverEmbed.results as Record<string, string>

    expect(audioCoverEmbedMessageKey(code)).toBe(`book.audioCoverEmbed.results.${code}`)
    expect(results[code]).toEqual(expect.any(String))
  })

  it('announces a finished embed as success, a no-op as news and a failure as an error', () => {
    const tones = Object.fromEntries(AUDIO_COVER_EMBED_CODES.map((code: AudioCoverEmbedCode) => [code, audioCoverEmbedTone(code)]))

    expect(tones).toEqual({
      embedded: 'success',
      unchanged: 'info',
      no_read_along_file: 'warning',
      no_audio_cover: 'warning',
      write_disabled: 'warning',
      over_size_limit: 'warning',
      unsupported: 'warning',
      failed: 'error',
    })
  })
})
