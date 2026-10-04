// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DEFAULT_KOREADER_DEVICE_PATTERN, DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE, DEFAULT_UPLOAD_PATTERN_BOOK_PER_FOLDER } from '@bookorbit/types'
import {
  canToggleOptional,
  displayOffset,
  displayText,
  joinWithPreviousLevel,
  patternLevels,
  patternOffset,
  splitPatternLevels,
  stripDisplayNewlines,
  toggleOptionalLevel,
} from '../pattern-levels'
import { DOWNLOAD_RECIPES, UPLOAD_RECIPES } from '../pattern-recipes'
import { PATTERN_EXAMPLES } from '../pattern-examples'

const everyShippedPattern = [
  DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE,
  DEFAULT_UPLOAD_PATTERN_BOOK_PER_FOLDER,
  DEFAULT_KOREADER_DEVICE_PATTERN,
  ...UPLOAD_RECIPES.flatMap((recipe) => Object.values(recipe.patterns ?? {})),
  ...DOWNLOAD_RECIPES.map((recipe) => recipe.downloadPattern ?? ''),
  ...PATTERN_EXAMPLES.flatMap((example) => Object.values(example.patterns).filter((pattern): pattern is string => pattern !== null)),
]

describe('splitPatternLevels', () => {
  it('reads the File as Book default as an author folder, an optional series folder and a file', () => {
    expect(splitPatternLevels(DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE)).toEqual([
      { text: '<{authors:first}|Unknown Author>/', kind: 'folder' },
      { text: '<{series}/>', kind: 'optional' },
      { text: '<{seriesIndex}. ><{title}|{originalFilename}>< ({year})>', kind: 'file' },
    ])
  })

  it('never splits inside an optional group that is more than one folder', () => {
    expect(splitPatternLevels('<Series/{series}/|Standalone/>{title}')).toEqual([{ text: '<Series/{series}/|Standalone/>{title}', kind: 'file' }])
  })

  it('leaves an empty file level for a pattern ending in a slash', () => {
    expect(splitPatternLevels('{authors}/').at(-1)).toEqual({ text: '', kind: 'file' })
  })

  it.each(everyShippedPattern)('joins back to exactly %s', (pattern) => {
    expect(
      splitPatternLevels(pattern)
        .map((level) => level.text)
        .join(''),
    ).toBe(pattern)
  })
})

describe('patternLevels', () => {
  it('marks the last folder of a Folder as Book pattern as the book folder', () => {
    const levels = patternLevels(DEFAULT_UPLOAD_PATTERN_BOOK_PER_FOLDER, 'book_per_folder', 'upload')
    expect(levels.map((level) => level.bookFolder)).toEqual([false, false, true, false])
  })

  it('marks no book folder for File as Book', () => {
    expect(patternLevels(DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE, 'book_per_file', 'upload').some((level) => level.bookFolder)).toBe(false)
  })

  it('keeps a download pattern as one level even when it contains a slash', () => {
    expect(patternLevels('{authors}/{title}', null, 'download')).toEqual([{ text: '{authors}/{title}', kind: 'file', bookFolder: false }])
  })
})

describe('line-per-level display', () => {
  const pattern = DEFAULT_UPLOAD_PATTERN_BOOK_PER_FOLDER
  const levels = patternLevels(pattern, 'book_per_folder', 'upload')
  const display = displayText(levels)

  it('puts each level on its own line and strips back to the saved pattern', () => {
    expect(display.split('\n')).toHaveLength(4)
    expect(stripDisplayNewlines(display)).toBe(pattern)
  })

  it('maps every pattern offset to the display and back', () => {
    for (let offset = 0; offset <= pattern.length; offset += 1) {
      expect(patternOffset(display, displayOffset(levels, offset))).toBe(offset)
    }
  })

  it('puts a caret that sits right after a slash at the start of the next line', () => {
    const afterFirstSlash = levels[0]!.text.length
    expect(display.charAt(displayOffset(levels, afterFirstSlash) - 1)).toBe('\n')
  })
})

describe('joinWithPreviousLevel', () => {
  it('removes the slash that ended the previous folder', () => {
    expect(joinWithPreviousLevel('{authors}/{title}', 10)).toEqual({ pattern: '{authors}{title}', offset: 9 })
  })

  it('removes the slash inside an optional folder, keeping its brackets', () => {
    expect(joinWithPreviousLevel('<{series}/>{title}', 11)).toEqual({ pattern: '<{series}>{title}', offset: 10 })
  })

  it('does nothing where no level boundary precedes the caret', () => {
    expect(joinWithPreviousLevel('{title}', 0)).toBeNull()
    expect(joinWithPreviousLevel('{title}', 7)).toBeNull()
  })
})

describe('toggleOptionalLevel', () => {
  it('wraps a plain folder so it is skipped when empty, and unwraps it again', () => {
    const levels = patternLevels('{authors}/{series}/{title}', 'book_per_file', 'upload')
    const wrapped = toggleOptionalLevel(levels, 1)
    expect(wrapped).toBe('{authors}/<{series}/>{title}')
    expect(toggleOptionalLevel(patternLevels(wrapped!, 'book_per_file', 'upload'), 1)).toBe('{authors}/{series}/{title}')
  })

  it('refuses a folder that already has a fallback, since it can never be empty', () => {
    const [author] = patternLevels(DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE, 'book_per_file', 'upload')
    expect(canToggleOptional(author!)).toBe(false)
  })

  it('refuses the Folder as Book book folder and the file name', () => {
    const levels = patternLevels('{authors}/{title}/{title}', 'book_per_folder', 'upload')
    expect(levels.map(canToggleOptional)).toEqual([true, false, false])
  })
})
