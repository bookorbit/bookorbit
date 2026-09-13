// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE } from '@bookorbit/types'
import { MISSING_METADATA_CASES, PREVIEW_CASES, previewDownloadName, previewUploadPath, splitResolvedPath } from '../pattern-preview'

const plain = { sanitizeForCrossPlatform: false }

describe('preview cases', () => {
  it('offers the complete book plus one variant per missing field', () => {
    expect(PREVIEW_CASES.map((previewCase) => previewCase.id)).toEqual(['complete', 'noSeries', 'noYear', 'noAuthor'])
    expect(MISSING_METADATA_CASES.map((previewCase) => previewCase.id)).toEqual(['noSeries', 'noYear', 'noAuthor'])
  })

  it('blanks only the field a variant is named for', () => {
    const noYear = PREVIEW_CASES.find((previewCase) => previewCase.id === 'noYear')

    expect(noYear?.metadata.year).toBe('')
    expect(noYear?.metadata.title).toBe('Neuromancer')
  })
})

describe('previewUploadPath', () => {
  it('resolves the shipped default to a leading-slashed path', () => {
    expect(previewUploadPath(DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE, plain)).toBe('/William Gibson/Sprawl/01. Neuromancer (1984).epub')
  })

  it('drops an optional segment whose token is empty', () => {
    const noSeries = MISSING_METADATA_CASES[0]!.metadata

    expect(previewUploadPath(DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE, plain, noSeries)).toBe('/William Gibson/Neuromancer (1984).epub')
  })

  it('uses the fallback side of an optional group when the primary cannot be filled', () => {
    const noAuthor = MISSING_METADATA_CASES[2]!.metadata

    expect(previewUploadPath(DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE, plain, noAuthor)).toContain('/Unknown Author/')
  })

  it('returns an empty string for a pattern that resolves to nothing', () => {
    expect(previewUploadPath('<{series}>', plain, { ...MISSING_METADATA_CASES[0]!.metadata })).toBe('')
  })

  it('returns an empty string for a blank pattern', () => {
    expect(previewUploadPath('   ', plain)).toBe('')
  })

  // Sanitization rewrites resolved metadata values, not literal text typed into the
  // pattern, so the preview has to be fed a value that actually carries a bad character.
  it('replaces characters Windows rejects inside a resolved value', () => {
    const metadata = { ...PREVIEW_CASES[0]!.metadata, title: 'Neuromancer: Sprawl' }

    expect(previewUploadPath('{title}', { sanitizeForCrossPlatform: true }, metadata)).toBe('/Neuromancer_ Sprawl.epub')
    expect(previewUploadPath('{title}', plain, metadata)).toBe('/Neuromancer: Sprawl.epub')
  })
})

describe('previewDownloadName', () => {
  it('resolves to a bare filename with no folders', () => {
    const name = previewDownloadName('<{authors:first} - ><{title}|{originalFilename}>', plain)

    expect(name).toBe('William Gibson - Neuromancer.epub')
    expect(name).not.toContain('/')
  })

  it('falls back to the shipped default when the pattern is empty', () => {
    expect(previewDownloadName('', plain)).toBe('neuromancer.epub')
  })
})

describe('splitResolvedPath', () => {
  it('separates folders, filename stem and extension', () => {
    expect(splitResolvedPath('/William Gibson/Sprawl/01. Neuromancer (1984).epub')).toEqual({
      folders: ['William Gibson', 'Sprawl'],
      stem: '01. Neuromancer (1984)',
      extension: '.epub',
    })
  })

  it('handles a filename with no folders', () => {
    expect(splitResolvedPath('neuromancer.epub')).toEqual({ folders: [], stem: 'neuromancer', extension: '.epub' })
  })

  it('handles a name with no extension', () => {
    expect(splitResolvedPath('/books/neuromancer')).toEqual({ folders: ['books'], stem: 'neuromancer', extension: '' })
  })

  it('returns empty parts for an empty path', () => {
    expect(splitResolvedPath('')).toEqual({ folders: [], stem: '', extension: '' })
  })
})
