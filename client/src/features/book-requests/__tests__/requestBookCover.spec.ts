import { describe, expect, it } from 'vitest'
import { requestBookCoverSources } from '../requestBookCover'

describe('requestBookCoverSources', () => {
  it('offers nothing for a request that names no book', () => {
    expect(requestBookCoverSources({ mediaKind: 'audiobook', matchedBookId: null, targetBookId: null })).toEqual([])
  })

  it("asks the book a format request joins for that format's cover", () => {
    expect(requestBookCoverSources({ mediaKind: 'audiobook', matchedBookId: null, targetBookId: 434 })).toEqual([
      '/api/v1/books/434/thumbnail?medium=audio',
    ])
    expect(requestBookCoverSources({ mediaKind: 'ebook', matchedBookId: null, targetBookId: 434 })).toEqual([
      '/api/v1/books/434/thumbnail?medium=ebook',
    ])
  })

  it('prefers the book the request became over the one it was aimed at', () => {
    expect(requestBookCoverSources({ mediaKind: 'audiobook', matchedBookId: 500, targetBookId: 434 })).toEqual([
      '/api/v1/books/500/thumbnail?medium=audio',
    ])
  })
})
