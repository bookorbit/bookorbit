// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE,
  DEFAULT_UPLOAD_PATTERN_BOOK_PER_FOLDER,
  EXAMPLE_PATTERN_METADATA,
  resolveUploadPath,
} from '@bookorbit/types'
import { firstToken, levelChanges, resolvePreview, splitExtension, type ResolveOptions } from '../pattern-resolution'
import { PREVIEW_BOOKS, withoutFields } from '../preview-books'

const FILE: ResolveOptions = { target: 'upload', mode: 'book_per_file', extension: 'epub', sanitize: true }
const FOLDER: ResolveOptions = { ...FILE, mode: 'book_per_folder' }

describe('resolvePreview', () => {
  it('names every level from the real resolver', () => {
    const preview = resolvePreview(DEFAULT_UPLOAD_PATTERN_BOOK_PER_FOLDER, EXAMPLE_PATTERN_METADATA, FOLDER)

    expect(preview.path).toBe(
      resolveUploadPath(DEFAULT_UPLOAD_PATTERN_BOOK_PER_FOLDER, EXAMPLE_PATTERN_METADATA, 'epub', { sanitizeForCrossPlatform: true }),
    )
    expect(preview.levels.map((level) => level.name)).toEqual(['William Gibson', 'Sprawl', '01. Neuromancer (1984)', '01. Neuromancer (1984).epub'])
    expect(preview.levels.map((level) => level.bookFolder)).toEqual([false, false, true, false])
  })

  it('marks an optional folder that dropped out as skipped, and keeps the rest aligned', () => {
    const preview = resolvePreview(DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE, withoutFields(EXAMPLE_PATTERN_METADATA, ['series', 'seriesIndex']), FILE)

    expect(preview.levels.map((level) => [level.name, level.skipped])).toEqual([
      ['William Gibson', false],
      ['', true],
      ['Neuromancer (1984).epub', false],
    ])
  })

  it('reports a level that fell back', () => {
    const preview = resolvePreview(DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE, withoutFields(EXAMPLE_PATTERN_METADATA, ['authors']), FILE)

    expect(preview.levels[0]).toMatchObject({ name: 'Unknown Author', usedFallback: true })
  })

  it('flags an unguarded folder that resolves to nothing as an empty name', () => {
    const preview = resolvePreview('{series}/{title}', withoutFields(EXAMPLE_PATTERN_METADATA, ['series']), FILE)

    expect(preview.levels[0]).toMatchObject({ skipped: true, emptyName: true })
    expect(preview.levels[1]).toMatchObject({ name: 'Neuromancer.epub' })
  })

  it('keeps the uploaded name for a pattern ending in a slash', () => {
    const preview = resolvePreview('{authors}/', EXAMPLE_PATTERN_METADATA, FILE)

    expect(preview.levels.at(-1)).toMatchObject({ name: 'neuromancer.epub', keepsUploadName: true, skipped: false })
  })

  it('reports a name the 255-byte limit shortened', () => {
    const longTitle = { ...EXAMPLE_PATTERN_METADATA, title: 'Neuromancer '.repeat(30) }
    const preview = resolvePreview('{title}', longTitle, FILE)

    expect(preview.levels[0]?.truncated).toBe(true)
    expect(resolvePreview('{title}', EXAMPLE_PATTERN_METADATA, FILE).levels[0]?.truncated).toBe(false)
  })

  it('resolves a download pattern to a single file name', () => {
    const preview = resolvePreview('<{authors:first} - >{title}', EXAMPLE_PATTERN_METADATA, { ...FILE, target: 'download', mode: null })

    expect(preview.path).toBe('William Gibson - Neuromancer.epub')
    expect(preview.levels).toHaveLength(1)
  })

  it('resolves every preview book under the shipped Folder as Book default', () => {
    for (const book of Object.values(PREVIEW_BOOKS)) {
      const preview = resolvePreview(DEFAULT_UPLOAD_PATTERN_BOOK_PER_FOLDER, book.metadata, { ...FOLDER, extension: book.extension })
      expect(preview.path.endsWith(`.${book.extension}`)).toBe(true)
    }
  })
})

describe('levelChanges', () => {
  it('lists only the levels a missing field changes', () => {
    const complete = resolvePreview(DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE, EXAMPLE_PATTERN_METADATA, FILE)
    const noYear = resolvePreview(DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE, withoutFields(EXAMPLE_PATTERN_METADATA, ['year']), FILE)

    expect(levelChanges(complete, noYear)).toEqual([
      {
        kind: 'file',
        bookFolder: false,
        from: '01. Neuromancer (1984).epub',
        to: '01. Neuromancer.epub',
        skipped: false,
        emptyName: false,
        usedFallback: false,
      },
    ])
  })

  it('reports a folder that dropped out as skipped', () => {
    const complete = resolvePreview(DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE, EXAMPLE_PATTERN_METADATA, FILE)
    const noSeries = resolvePreview(DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE, withoutFields(EXAMPLE_PATTERN_METADATA, ['series', 'seriesIndex']), FILE)

    expect(levelChanges(complete, noSeries)[0]).toMatchObject({ kind: 'optional', from: 'Sprawl', skipped: true })
  })

  it('reports an unguarded folder that loses its name as an empty name, not a skipped folder', () => {
    const complete = resolvePreview('{authors}/{title}', EXAMPLE_PATTERN_METADATA, FILE)
    const noAuthor = resolvePreview('{authors}/{title}', withoutFields(EXAMPLE_PATTERN_METADATA, ['authors']), FILE)

    expect(levelChanges(complete, noAuthor)).toEqual([
      { kind: 'folder', bookFolder: false, from: 'William Gibson', to: '', skipped: false, emptyName: true, usedFallback: false },
    ])
  })
})

describe('helpers', () => {
  it('splits the extension off a file name only when it matches', () => {
    expect(splitExtension('Neuromancer.epub', 'epub')).toEqual(['Neuromancer', '.epub'])
    expect(splitExtension('Neuromancer', 'epub')).toEqual(['Neuromancer', ''])
  })

  it('finds the first token a level reads', () => {
    expect(firstToken('<{series}/>')).toBe('series')
    expect(firstToken('Books/')).toBeNull()
  })
})
