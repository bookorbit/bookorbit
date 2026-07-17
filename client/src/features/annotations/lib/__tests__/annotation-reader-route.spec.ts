import { describe, expect, it } from 'vitest'
import type { AnnotationHubItem } from '@bookorbit/types'
import { annotationReaderRoute } from '../annotation-reader-route'

function annotation(overrides: Partial<AnnotationHubItem> = {}): AnnotationHubItem {
  return {
    id: 1,
    bookId: 5,
    cfi: 'epubcfi(/6/4!/4/2/1:0)',
    jumpFileId: 9,
    jumpFileFormat: 'epub',
    pageno: null,
    text: 'selected text',
    color: 'yellow',
    style: 'highlight',
    note: null,
    chapterTitle: 'Chapter 1',
    origin: 'web',
    positionStatus: 'exact',
    chapterIndex: 0,
    createdAt: '2026-07-12T00:00:00.000Z',
    bookTitle: 'A Book',
    author: 'An Author',
    deletedAt: null,
    ...overrides,
  }
}

describe('annotationReaderRoute', () => {
  it.each(['fb2', 'mobi', 'azw', 'azw3', 'txt', 'epub'])('passes the %s format to the reader', (format) => {
    expect(annotationReaderRoute(annotation({ jumpFileFormat: format }))).toEqual({
      name: 'reader',
      params: { bookId: 5, fileId: 9 },
      query: { format, cfi: 'epubcfi(/6/4!/4/2/1:0)' },
    })
  })

  it('uses the page number when the annotation has no CFI', () => {
    expect(annotationReaderRoute(annotation({ cfi: null, jumpFileFormat: 'pdf', pageno: 42 }))).toEqual({
      name: 'reader',
      params: { bookId: 5, fileId: 9 },
      query: { format: 'pdf', page: '42' },
    })
  })

  it('does not build a route without a jump file and its format', () => {
    expect(annotationReaderRoute(annotation({ jumpFileId: null }))).toBeNull()
    expect(annotationReaderRoute(annotation({ jumpFileFormat: null }))).toBeNull()
  })
})
