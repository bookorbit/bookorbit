import { describe, expect, it } from 'vitest'
import { METADATA_REMINDER_FIELDS, normalizeMetadataReminderFields } from '@bookorbit/types'
import { missingMetadataFields } from './missing-metadata'

const empty = {
  publisher: null,
  language: null,
  publishedYear: null,
  publishedDate: null,
  pageCount: null,
  isbn10: null,
  isbn13: null,
  genres: [],
  tags: [],
  description: null,
}

describe('missing metadata reminders', () => {
  it('uses defaults for absent or malformed preferences, and preserves an explicit empty selection', () => {
    expect(normalizeMetadataReminderFields(undefined)).toEqual(METADATA_REMINDER_FIELDS)
    expect(normalizeMetadataReminderFields('isbn')).toEqual(METADATA_REMINDER_FIELDS)
    expect(normalizeMetadataReminderFields([])).toEqual([])
    expect(normalizeMetadataReminderFields(['isbn', 'future-field', 'isbn'])).toEqual(['isbn'])
  })

  it('counts ISBN once when both identifiers are missing, and accepts either identifier', () => {
    expect(missingMetadataFields(empty, [], ['isbn'])).toEqual(['isbn'])
    expect(missingMetadataFields({ ...empty, isbn10: '0593419111' }, [], ['isbn'])).toEqual([])
    expect(missingMetadataFields({ ...empty, isbn13: '9780593419113' }, [], ['isbn'])).toEqual([])
  })

  it('accepts either a publication year or full date', () => {
    expect(missingMetadataFields({ ...empty, publishedYear: 2023 }, [], ['publication'])).toEqual([])
    expect(missingMetadataFields({ ...empty, publishedDate: '2023-04-25' }, [], ['publication'])).toEqual([])
  })

  it('skips page count for audio-only content, including a supplementary PDF', () => {
    const files = [
      { format: 'm4b', role: 'primary' },
      { format: 'pdf', role: 'supplement' },
    ]
    expect(missingMetadataFields(empty, files, ['pageCount'])).toEqual([])
  })

  it('checks page count for mixed media even when audio is primary, and for comics', () => {
    const files = [
      { format: 'm4b', role: 'primary' },
      { format: 'epub', role: 'content' },
    ]
    expect(missingMetadataFields(empty, files, ['pageCount'])).toEqual(['pageCount'])
    expect(missingMetadataFields(empty, [{ format: 'cbz', role: 'content' }], ['pageCount'])).toEqual(['pageCount'])
  })

  it('ignores unchecked fields and treats whitespace-only text and lists as empty', () => {
    const metadata = { ...empty, publisher: '  ', genres: ['  '], tags: ['Cooking'], description: 'A cookbook' }
    expect(missingMetadataFields(metadata, [], ['publisher', 'genres', 'tags', 'description'])).toEqual(['publisher', 'genres'])
    expect(missingMetadataFields(metadata, [], [])).toEqual([])
  })

  it('does not turn a present zero into a missing-field reminder', () => {
    expect(missingMetadataFields({ ...empty, pageCount: 0 }, [], ['pageCount'])).toEqual([])
  })
})
