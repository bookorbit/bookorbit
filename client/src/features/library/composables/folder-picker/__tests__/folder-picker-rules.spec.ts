// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { FolderSummary } from '@bookorbit/types'
import {
  ancestorsWithin,
  attentionFor,
  booksAs,
  folderStatus,
  overlapStatus,
  rangeBetween,
  toggleFolder,
  type PickerLibrary,
  type StatusContext,
} from '../folder-picker-rules'

const novels: PickerLibrary = { id: 1, name: 'Novels', icon: 'BookOpen', folders: ['/books/Ebooks/Fiction'] }
const comics: PickerLibrary = { id: 2, name: 'Comics', icon: null, folders: ['/books/Comics'] }

function context(overrides: Partial<StatusContext> = {}): StatusContext {
  return { denied: false, appData: false, own: [], selected: [], others: [novels, comics], ...overrides }
}

function summary(overrides: Partial<FolderSummary> = {}): FolderSummary {
  return {
    path: '/x',
    state: 'ok',
    files: 12,
    folderBooks: 3,
    formats: { epub: 12 },
    folders: 3,
    mergedFolders: 0,
    splitAudioFolders: 0,
    truncated: false,
    ...overrides,
  }
}

describe('folderStatus', () => {
  it('refuses unreadable folders and the data folder before anything else', () => {
    expect(folderStatus('/books', context({ denied: true }))).toEqual({ kind: 'denied', block: true })
    expect(folderStatus('/data', context({ appData: true }))).toEqual({ kind: 'appData', block: true })
  })

  it('marks this library’s own folders and everything inside them', () => {
    const ctx = context({ own: ['/books/Ebooks/Fiction/'] })

    expect(folderStatus('/books/Ebooks/Fiction', ctx)).toEqual({ kind: 'own', block: true })
    expect(folderStatus('/books/Ebooks/Fiction/Jane Austen', ctx)).toEqual({ kind: 'ownCovered', block: true, cover: '/books/Ebooks/Fiction' })
  })

  it('keeps the overlap warning on a ticked folder', () => {
    const status = folderStatus('/books/Ebooks', context({ selected: ['/books/Ebooks'] }))

    expect(status).toMatchObject({ kind: 'selected', warn: true, over: 'contains', library: novels })
  })

  it('shows folders under a ticked one as included', () => {
    expect(folderStatus('/books/Ebooks/Science Fiction/Ann Leckie', context({ selected: ['/books/Ebooks/Science Fiction'] }))).toEqual({
      kind: 'included',
      block: true,
      cover: '/books/Ebooks/Science Fiction',
    })
  })

  it('is quiet for a folder no library touches', () => {
    expect(folderStatus('/books/Unsorted', context())).toBeNull()
  })
})

describe('overlapStatus', () => {
  it('tells a library’s own folder, a folder inside it, and a folder holding it apart', () => {
    expect(overlapStatus('/books/Comics', [novels, comics])).toMatchObject({ kind: 'overlap', exact: true, library: comics })
    expect(overlapStatus('/books/Comics/Saga (2012)', [novels, comics])).toMatchObject({ kind: 'overlap', exact: false, library: comics })
    expect(overlapStatus('/books', [novels, comics])).toMatchObject({ kind: 'contains', libraries: [novels, comics] })
    expect(overlapStatus('/media', [novels, comics])).toBeNull()
  })

  it('does not treat a sibling with a shared prefix as inside', () => {
    expect(overlapStatus('/books/Comics Archive', [comics])).toBeNull()
  })
})

describe('toggleFolder', () => {
  it('folds picks inside a newly ticked parent and reports them', () => {
    expect(toggleFolder(['/books/Ebooks/Fiction/Jane Austen', '/media'], '/books/Ebooks')).toEqual({
      selected: ['/books/Ebooks', '/media'],
      folded: ['/books/Ebooks/Fiction/Jane Austen'],
    })
  })

  it('unticks a ticked folder', () => {
    expect(toggleFolder(['/books', '/media'], '/books/')).toEqual({ selected: ['/media'], folded: [] })
  })
})

describe('booksAs', () => {
  it('counts folders as books in Folder as Book and files in File as Book', () => {
    expect(booksAs(summary(), 'book_per_folder')).toBe(3)
    expect(booksAs(summary(), 'book_per_file')).toBe(12)
    expect(booksAs(undefined, 'book_per_file')).toBe(0)
  })
})

describe('attentionFor', () => {
  it('flags merging folders only in Folder as Book, and split audiobooks only in File as Book', () => {
    expect(attentionFor(summary({ mergedFolders: 2 }), null, 'book_per_folder')).toEqual({ kind: 'merge' })
    expect(attentionFor(summary({ mergedFolders: 2 }), null, 'book_per_file')).toBeNull()
    expect(attentionFor(summary({ splitAudioFolders: 1 }), null, 'book_per_file')).toEqual({ kind: 'split' })
  })

  it('puts overlaps first, as contains or overlap', () => {
    const contains = folderStatus('/books', context({ selected: ['/books'] }))
    const inside = folderStatus('/books/Comics/Saga', context({ selected: ['/books/Comics/Saga'] }))

    expect(attentionFor(summary({ mergedFolders: 3 }), contains, 'book_per_folder')).toMatchObject({ kind: 'contains' })
    expect(attentionFor(summary(), inside, 'book_per_folder')).toMatchObject({ kind: 'overlap' })
  })
})

describe('rangeBetween and ancestorsWithin', () => {
  it('returns the run between two siblings either way round', () => {
    const siblings = ['/a', '/b', '/c', '/d']

    expect(rangeBetween(siblings, '/b', '/d')).toEqual(['/b', '/c', '/d'])
    expect(rangeBetween(siblings, '/d', '/b')).toEqual(['/b', '/c', '/d'])
    expect(rangeBetween(siblings, '/x', '/b')).toEqual([])
  })

  it('lists the folders between a root and a path, and stops at the filesystem root', () => {
    expect(ancestorsWithin('/books/Ebooks/Fiction/Jane Austen', '/')).toEqual(['/books', '/books/Ebooks', '/books/Ebooks/Fiction'])
    expect(ancestorsWithin('/books/Ebooks/Fiction', '/books')).toEqual(['/books/Ebooks'])
    expect(ancestorsWithin('/books', '/')).toEqual([])
    expect(ancestorsWithin('/elsewhere/x', '/books')).toEqual([])
  })
})
