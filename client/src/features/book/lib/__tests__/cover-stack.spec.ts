import { describe, expect, it } from 'vitest'
import type { BookDetail } from '@bookorbit/types'
import { hasCoverPair } from '../cover-stack'

const slot = { source: 'extracted' as const, updatedAt: '2026-01-01T00:00:00.000Z', width: null, height: null }

describe('hasCoverPair', () => {
  it('needs art in both slots', () => {
    expect(hasCoverPair({ covers: { ebook: slot, audio: slot } } as Pick<BookDetail, 'covers'>)).toBe(true)
  })

  it.each([
    ['only the book', { ebook: slot, audio: null }],
    ['only the audiobook', { ebook: null, audio: slot }],
    ['neither', { ebook: null, audio: null }],
  ])('is false with %s', (_name, covers) => {
    expect(hasCoverPair({ covers } as Pick<BookDetail, 'covers'>)).toBe(false)
  })
})
