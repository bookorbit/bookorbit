// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { BookCoverSlot, BookDetail } from '@bookorbit/types'

import { resolveWriteBackFields } from '../write-back-fields'

function slot(source: BookCoverSlot['source']): BookCoverSlot {
  return { source, updatedAt: '2026-01-01T00:00:00.000Z', width: 400, height: 600 }
}

function book(overrides: Partial<BookDetail>): BookDetail {
  return {
    coverSource: null,
    covers: { ebook: null, audio: null },
    files: [],
    ...overrides,
  } as BookDetail
}

function coverValue(detail: BookDetail): string | null {
  return resolveWriteBackFields(detail, ['coverBytes'])[0]!.value
}

describe('write-back cover preview', () => {
  it('shows the book cover for an EPUB write, not the summary of both slots', () => {
    const detail = book({
      coverSource: 'custom',
      covers: { ebook: slot('extracted'), audio: slot('custom') },
      files: [
        { format: 'epub', role: 'primary' },
        { format: 'm4b', role: 'content' },
      ] as BookDetail['files'],
    })

    expect(coverValue(detail)).toBe('extracted')
  })

  it('shows the audiobook cover for an audio write, and nothing when that slot is empty', () => {
    const files = [
      { format: 'm4b', role: 'primary' },
      { format: 'epub', role: 'content' },
    ] as BookDetail['files']

    expect(coverValue(book({ covers: { ebook: slot('extracted'), audio: slot('custom') }, files }))).toBe('custom')
    expect(coverValue(book({ coverSource: 'extracted', covers: { ebook: slot('extracted'), audio: null }, files }))).toBeNull()
  })

  it('falls back to the single legacy cover of a book the upgrade has not reached', () => {
    expect(coverValue(book({ coverSource: 'custom', files: [{ format: 'epub', role: 'primary' }] as BookDetail['files'] }))).toBe('custom')
  })
})
