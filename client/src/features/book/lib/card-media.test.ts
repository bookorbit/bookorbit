import { describe, expect, it } from 'vitest'
import type { BookCard } from '@bookorbit/types'
import { cardMediaView } from './card-media'

type CardBook = Pick<BookCard, 'files' | 'coverAspectRatio'>

function makeBook(formats: string[], coverAspectRatio: CardBook['coverAspectRatio'] = '2/3'): CardBook {
  return {
    coverAspectRatio,
    files: formats.map((format, index) => ({ id: index + 1, format, role: index === 0 ? 'primary' : 'content', sizeBytes: null })),
  }
}

describe('cardMediaView', () => {
  it('returns null without a media kind', () => {
    expect(cardMediaView(makeBook(['epub', 'm4b']), null)).toBeNull()
    expect(cardMediaView(makeBook(['epub', 'm4b']), undefined)).toBeNull()
  })

  it('returns null when the book has no file of the kind, so it keeps its own face', () => {
    expect(cardMediaView(makeBook(['epub']), 'audiobook')).toBeNull()
    expect(cardMediaView(makeBook(['m4b'], '1/1'), 'ebook')).toBeNull()
  })

  it('ignores sidecar files when deciding whether the book has the kind', () => {
    const book: CardBook = {
      coverAspectRatio: '2/3',
      files: [
        { id: 1, format: 'epub', role: 'primary', sizeBytes: null },
        { id: 2, format: 'mp3', role: 'supplement', sizeBytes: null },
      ],
    }

    expect(cardMediaView(book, 'audiobook')).toBeNull()
  })

  it('asks for the audio cover in a square frame when the default face is the ebook', () => {
    expect(cardMediaView(makeBook(['epub', 'm4b'], '2/3'), 'audiobook')).toEqual({ kind: 'audiobook', coverAspectRatio: '1/1', coverMedium: 'audio' })
  })

  it('asks for the ebook cover in a portrait frame when the default face is the audiobook', () => {
    expect(cardMediaView(makeBook(['m4b', 'epub'], '1/1'), 'ebook')).toEqual({ kind: 'ebook', coverAspectRatio: '2/3', coverMedium: 'ebook' })
  })

  it('keeps the default cover URL when the default face already serves the medium', () => {
    expect(cardMediaView(makeBook(['m4b'], '1/1'), 'audiobook')).toEqual({ kind: 'audiobook', coverAspectRatio: '1/1', coverMedium: undefined })
    expect(cardMediaView(makeBook(['epub', 'm4b'], '2/3'), 'ebook')).toEqual({ kind: 'ebook', coverAspectRatio: '2/3', coverMedium: undefined })
  })

  it('shows a comic from the ebook cover slot', () => {
    expect(cardMediaView(makeBook(['m4b', 'cbz'], '1/1'), 'comic')).toEqual({ kind: 'comic', coverAspectRatio: '2/3', coverMedium: 'ebook' })
  })
})
