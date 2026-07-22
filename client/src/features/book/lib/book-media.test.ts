import { describe, expect, it } from 'vitest'
import { getBookMediaKind, getBookMediaProfile, getPrimaryBookFile, normalizeCoverAspectRatio, type BookFileRef } from '@bookorbit/types'

function file(id: number, format: string | null, role: string): BookFileRef {
  return { id, format, role, sizeBytes: null }
}

describe('book media profile', () => {
  it('uses the explicit primary file regardless of file order', () => {
    const files = [file(1, 'm4b', 'content'), file(2, 'epub', 'primary'), file(3, 'cbz', 'content')]

    expect(getPrimaryBookFile(files)?.id).toBe(2)
    expect(getBookMediaProfile(files)).toEqual({
      primaryMediaKind: 'ebook',
      hasEbook: true,
      hasAudio: true,
      hasComic: true,
    })
  })

  it('falls back to the first formatted file when no primary file exists', () => {
    const files = [file(1, null, 'content'), file(2, 'M4B', 'content'), file(3, 'epub', 'content')]

    expect(getPrimaryBookFile(files)?.id).toBe(2)
    expect(getBookMediaProfile(files).primaryMediaKind).toBe('audiobook')
  })

  it.each([
    [' EPUB ', 'ebook'],
    ['m4A', 'audiobook'],
    ['CB7', 'comic'],
    [null, 'unknown'],
  ] as const)('classifies %s as %s', (format, expected) => {
    expect(getBookMediaKind(format)).toBe(expected)
  })

  it('reports an empty book without inventing media capabilities', () => {
    expect(getBookMediaProfile([])).toEqual({
      primaryMediaKind: 'unknown',
      hasEbook: false,
      hasAudio: false,
      hasComic: false,
    })
  })
})

describe('cover aspect ratio normalization', () => {
  it.each([
    ['1/1', '1/1'],
    ['2/3', '2/3'],
    ['invalid', '2/3'],
    [null, '2/3'],
  ] as const)('normalizes %s to %s', (value, expected) => {
    expect(normalizeCoverAspectRatio(value)).toBe(expected)
  })
})
