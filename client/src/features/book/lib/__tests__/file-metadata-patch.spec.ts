import { describe, expect, it } from 'vitest'
import type { FileMetadata } from '../../composables/useFileMetadata'
import { buildFileMetadataPatch } from '../file-metadata-patch'

describe('buildFileMetadataPatch', () => {
  it('maps provider IDs from embedded file metadata, including RanobeDB', () => {
    const patch = buildFileMetadataPatch({
      googleBooksId: 'google-1',
      goodreadsId: 'goodreads-1',
      amazonId: 'B00TEST',
      hardcoverId: 'hardcover-1',
      openLibraryId: 'OL123W',
      itunesId: 'itunes-1',
      audibleId: 'audible-1',
      comicvineId: 'comicvine-1',
      ranobedbId: 'ranobe-1',
    })

    expect(patch).toEqual({
      googleBooksId: 'google-1',
      goodreadsId: 'goodreads-1',
      amazonId: 'B00TEST',
      hardcoverId: 'hardcover-1',
      openLibraryId: 'OL123W',
      itunesId: 'itunes-1',
      audibleId: 'audible-1',
      comicvineId: 'comicvine-1',
      ranobedbId: 'ranobe-1',
    })
  })

  it('preserves explicit nulls but omits fields absent from the file response', () => {
    const meta: FileMetadata = {
      title: 'File Title',
      subtitle: null,
      publisher: undefined,
      ranobedbId: null,
    }

    const patch = buildFileMetadataPatch(meta)

    expect(patch).toEqual({
      title: 'File Title',
      subtitle: null,
      ranobedbId: null,
    })
    expect('publisher' in patch).toBe(false)
  })

  it('carries scalar, list, audio, and comic metadata through one patch', () => {
    const patch = buildFileMetadataPatch({
      title: 'Dune',
      publishedYear: 1965,
      pageCount: 412,
      authors: ['Frank Herbert'],
      genres: ['Science Fiction'],
      narrators: ['Simon Vance'],
      durationSeconds: 3600,
      comicMetadata: {
        issueNumber: '1',
        volumeName: 'Volume One',
        pencillers: ['Artist One'],
      },
    })

    expect(patch).toEqual({
      title: 'Dune',
      publishedYear: 1965,
      pageCount: 412,
      authors: ['Frank Herbert'],
      genres: ['Science Fiction'],
      narrators: ['Simon Vance'],
      durationSeconds: 3600,
      comicMetadata: {
        issueNumber: '1',
        volumeName: 'Volume One',
        pencillers: ['Artist One'],
      },
    })
  })
})
