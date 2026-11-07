import { describe, expect, it } from 'vitest'
import type { BookDetail } from '@bookorbit/types'
import { hasChaptersTab } from '../book-detail-tabs'

type TabBook = Pick<BookDetail, 'audioMetadata' | 'files'>

function book(files: Array<Record<string, unknown>>, audioMetadata: unknown = null): TabBook {
  return { audioMetadata, files } as unknown as TabBook
}

const READ_ALONG = { id: 1, format: 'epub', role: 'content', mediaOverlay: { available: true, durationSeconds: 3600 } }

describe('hasChaptersTab', () => {
  it('is off until there is a book', () => {
    expect(hasChaptersTab(null)).toBe(false)
    expect(hasChaptersTab(undefined)).toBe(false)
  })

  it('is on for a book with audio files', () => {
    expect(hasChaptersTab(book([{ id: 1, format: 'm4b', role: 'content' }], { narrators: [] }))).toBe(true)
  })

  it('is on for an EPUB that carries read-along narration', () => {
    expect(hasChaptersTab(book([READ_ALONG]))).toBe(true)
    expect(hasChaptersTab(book([{ ...READ_ALONG, role: 'primary' }]))).toBe(true)
  })

  it.each([
    ['a plain EPUB', [{ id: 1, format: 'epub', role: 'content', mediaOverlay: { available: false, durationSeconds: null } }]],
    ['an EPUB never checked for narration', [{ id: 1, format: 'epub', role: 'content' }]],
    ['a supplementary read-along EPUB', [{ ...READ_ALONG, role: 'supplement' }]],
    ['a book with neither', [{ id: 1, format: 'pdf', role: 'content' }]],
  ])('is off for %s', (_label, files) => {
    expect(hasChaptersTab(book(files))).toBe(false)
  })
})
