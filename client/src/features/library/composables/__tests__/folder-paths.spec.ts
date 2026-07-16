import { describe, expect, it } from 'vitest'
import { consolidateFolderPaths, coveringFolderPath, normalizeFolderPath } from '../folder-paths'

describe('folder path selection', () => {
  it('normalizes trailing slashes without changing the filesystem root', () => {
    expect(normalizeFolderPath('/books/')).toBe('/books')
    expect(normalizeFolderPath('/')).toBe('/')
  })

  it('keeps only top-level paths when selections overlap', () => {
    expect(consolidateFolderPaths(['/books/fiction', '/audio', '/books', '/books/fantasy'])).toEqual(['/audio', '/books'])
  })

  it('finds the selected path that already covers a nested folder', () => {
    expect(coveringFolderPath('/books/fiction/scifi', ['/books', '/books/fiction'])).toBe('/books/fiction')
  })
})
