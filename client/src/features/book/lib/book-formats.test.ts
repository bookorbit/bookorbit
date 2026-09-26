// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { READ_ALONG_FORMAT_PRIORITY, type BookFileRef } from '@bookorbit/types'

import { i18n } from '@/i18n'
import { bookFormatEntries, formatKeyCode, formatKeyName, rankedContentFiles } from './book-formats'

function file(id: number, format: string | null, role = 'content', extra: Partial<BookFileRef> = {}): BookFileRef {
  return { id, format, role, sizeBytes: 100, ...extra }
}

const readAlong = { mediaOverlay: { available: true, durationSeconds: 60 } }

describe('bookFormatEntries', () => {
  it('lists content files only, never covers or sidecars', () => {
    const entries = bookFormatEntries([file(1, 'epub', 'primary'), file(2, 'jpg', 'cover'), file(3, 'txt', 'supplement'), file(4, 'opf', 'metadata')])
    expect(entries.map((entry) => entry.key)).toEqual(['epub'])
  })

  it('keeps a read-along EPUB apart from a plain one', () => {
    const entries = bookFormatEntries([file(1, 'epub', 'primary'), file(2, 'epub', 'content', readAlong)])
    expect(entries.map((entry) => [entry.key, entry.readAlong])).toEqual([
      ['epub', false],
      [READ_ALONG_FORMAT_PRIORITY, true],
    ])
  })

  it("collapses an audiobook's tracks into one entry in track order", () => {
    const entries = bookFormatEntries([file(1, 'mp3'), file(2, 'epub', 'primary'), file(3, 'mp3')])
    const audio = entries.find((entry) => entry.audio)!
    expect(audio.key).toBe('mp3')
    expect(audio.files.map((f) => f.id)).toEqual([1, 3])
    expect(audio.sizeBytes).toBe(200)
  })

  it('puts the primary first and ranks the rest by the library priority', () => {
    const files = [file(1, 'pdf', 'primary'), file(2, 'epub'), file(3, 'm4b'), file(4, 'epub', 'content', readAlong)]
    const keys = bookFormatEntries(files, [READ_ALONG_FORMAT_PRIORITY, 'm4b', 'epub', 'pdf']).map((entry) => entry.key)
    expect(keys).toEqual(['pdf', READ_ALONG_FORMAT_PRIORITY, 'm4b', 'epub'])
  })

  it('places read-along directly before epub when the stored list predates it', () => {
    const files = [file(1, 'm4b', 'primary'), file(2, 'epub'), file(3, 'epub', 'content', readAlong)]
    expect(bookFormatEntries(files, ['m4b', 'epub']).map((entry) => entry.key)).toEqual(['m4b', READ_ALONG_FORMAT_PRIORITY, 'epub'])
  })

  it('keeps the source order when no priority is given', () => {
    expect(bookFormatEntries([file(1, 'pdf'), file(2, 'epub')]).map((entry) => entry.key)).toEqual(['pdf', 'epub'])
  })

  it('returns every content file in edition order', () => {
    const files = [file(1, 'mp3'), file(2, 'jpg', 'cover'), file(3, 'epub', 'primary'), file(4, 'mp3')]
    expect(rankedContentFiles(files).map((f) => f.id)).toEqual([3, 1, 4])
  })
})

describe('format labels', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'en'
  })

  it('shows the file format as the code, EPUB for a read-along', () => {
    expect(formatKeyCode('m4b')).toBe('M4B')
    expect(formatKeyCode(READ_ALONG_FORMAT_PRIORITY)).toBe('EPUB')
  })

  it('names formats from the translated catalog', () => {
    expect(formatKeyName('epub')).toBe('EPUB e-book')
    expect(formatKeyName(READ_ALONG_FORMAT_PRIORITY)).toBe('Read-along EPUB')
    expect(formatKeyName('djvu')).toBe('DJVU')
  })
})
