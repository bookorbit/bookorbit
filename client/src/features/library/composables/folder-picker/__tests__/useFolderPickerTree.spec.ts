// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { ref, shallowReactive } from 'vue'
import type { FolderListing, FolderListingEntry, FolderPlaces, FolderSummary } from '@bookorbit/types'
import type { FolderPickerData } from '../useFolderPickerData'
import { useFolderPickerTree } from '../useFolderPickerTree'

function entry(path: string, extra: Partial<FolderListingEntry> = {}): FolderListingEntry {
  return { name: path.slice(path.lastIndexOf('/') + 1), path, mount: false, system: false, appData: false, hasChildren: true, ...extra }
}

function fakeData(
  listings: Record<string, FolderListingEntry[]>,
  files: Record<string, number> = {},
  options: { truncatedListings?: string[]; truncatedCounts?: string[] } = {},
) {
  const places = ref<FolderPlaces | null>({ root: '/', mounts: ['/books'], appDataPath: '/data', libraries: [] })
  const map = shallowReactive(new Map<string, FolderListing>())
  for (const [path, entries] of Object.entries(listings))
    map.set(path, { path, state: 'ok', entries, truncated: !!options.truncatedListings?.includes(path) })
  const summaries = shallowReactive(new Map<string, FolderSummary>())
  for (const [path, count] of Object.entries(files))
    summaries.set(path, {
      path,
      state: 'ok',
      files: count,
      folderBooks: count,
      formats: {},
      folders: 0,
      mergedFolders: 0,
      splitAudioFolders: 0,
      truncated: !!options.truncatedCounts?.includes(path),
    })
  return { places, listings: map, summaries, ensureListing: vi.fn<() => Promise<null>>(() => Promise.resolve(null)) } as unknown as FolderPickerData
}

const server = {
  '/': [entry('/books', { mount: true }), entry('/usr', { system: true }), entry('/mnt', { hasChildren: false })],
  '/books': [entry('/books/Manga'), entry('/books/Ebooks'), entry('/books/Periodicals', { hasChildren: false })],
  '/books/Ebooks': [entry('/books/Ebooks/Science Fiction')],
}

describe('useFolderPickerTree', () => {
  it('flattens open folders into rows, hiding system folders', () => {
    const tree = useFolderPickerTree(fakeData(server))
    tree.expanded.value = new Set(['/books'])

    expect(tree.rows.value.map((row) => [row.path, row.depth])).toEqual([
      ['/books', 0],
      ['/books/Ebooks', 1],
      ['/books/Manga', 1],
      ['/books/Periodicals', 1],
      ['/mnt', 0],
    ])
    expect(tree.hiddenSystemCount.value).toBe(1)
  })

  it('keeps a hidden system folder on the way to a picked folder', () => {
    const tree = useFolderPickerTree(fakeData(server), () => ['/usr/share/books'])

    expect(tree.rows.value.some((row) => row.path === '/usr')).toBe(true)
  })

  it('shows a loading row under a folder opened before it has listed', () => {
    const data = fakeData(server)
    const tree = useFolderPickerTree(data)
    tree.expanded.value = new Set(['/books', '/books/Manga'])

    expect(tree.rows.value.find((row) => row.type === 'loading')).toMatchObject({ path: '/books/Manga', depth: 2 })
  })

  it('puts the new-folder row first inside its folder', () => {
    const tree = useFolderPickerTree(fakeData(server))
    tree.expanded.value = new Set(['/books'])
    tree.newFolderParent.value = '/books'

    expect(tree.rows.value[1]).toMatchObject({ type: 'new', path: '/books', depth: 1 })
  })

  it('sorts by most books and hides folders without books when asked', () => {
    const tree = useFolderPickerTree(fakeData(server, { '/books/Manga': 180, '/books/Ebooks': 210, '/books/Periodicals': 0 }))
    tree.expanded.value = new Set(['/books'])
    tree.sort.value = 'books'
    tree.hideEmpty.value = true

    expect(tree.rows.value.filter((row) => row.depth === 1).map((row) => row.path)).toEqual(['/books/Ebooks', '/books/Manga'])
  })

  it('keeps a folder whose count stopped short at zero, since it may hold books', () => {
    const tree = useFolderPickerTree(
      fakeData(server, { '/books/Manga': 0, '/books/Ebooks': 0, '/books/Periodicals': 0 }, { truncatedCounts: ['/books/Ebooks'] }),
    )
    tree.expanded.value = new Set(['/books'])
    tree.hideEmpty.value = true

    expect(tree.rows.value.filter((row) => row.depth === 1).map((row) => row.path)).toEqual(['/books/Ebooks'])
  })

  it('ends a folder listed only in part with a row saying how to reach the rest', () => {
    const tree = useFolderPickerTree(fakeData(server, {}, { truncatedListings: ['/books'] }))
    tree.expanded.value = new Set(['/books'])

    expect(tree.rows.value.map((row) => [row.type, row.path]).slice(1, 5)).toEqual([
      ['folder', '/books/Ebooks'],
      ['folder', '/books/Manga'],
      ['folder', '/books/Periodicals'],
      ['more', '/books'],
    ])
  })

  it('makes the first folder the tab stop until one is focused', () => {
    const tree = useFolderPickerTree(fakeData(server))
    tree.expanded.value = new Set(['/books'])

    expect(tree.tabStop.value).toBe('/books')
    tree.focus.value = '/books/Manga'
    expect(tree.tabStop.value).toBe('/books/Manga')
    tree.focus.value = '/books/Ebooks/Science Fiction'
    expect(tree.tabStop.value).toBe('/books')
  })

  it('counts only the system folders it actually hides', () => {
    const tree = useFolderPickerTree(fakeData(server), () => ['/usr/local/books'])

    expect(tree.hiddenSystemCount.value).toBe(0)
  })

  it('shows find matches with the folders around them', () => {
    const tree = useFolderPickerTree(fakeData(server))
    tree.findResults.value = ['/books/Ebooks/Science Fiction/Martha Wells', '/books/Manga']

    expect(tree.rows.value.map((row) => [row.path, row.depth, !!row.hit])).toEqual([
      ['/books', 0, false],
      ['/books/Ebooks', 1, false],
      ['/books/Ebooks/Science Fiction', 2, false],
      ['/books/Ebooks/Science Fiction/Martha Wells', 3, true],
      ['/books/Manga', 1, true],
    ])
  })

  it('knows a folder is a leaf once its listing is empty, before that from its parent', () => {
    const tree = useFolderPickerTree(fakeData({ ...server, '/books/Manga': [] }))

    expect(tree.hasChildren('/books/Manga')).toBe(false)
    expect(tree.hasChildren('/books/Ebooks')).toBe(true)
    expect(tree.hasChildren('/books/Periodicals')).toBe(false)
  })

  it('reveals a folder by opening its parents and focusing it', () => {
    const tree = useFolderPickerTree(fakeData(server))

    tree.reveal('/books/Ebooks/Science Fiction/')

    expect([...tree.expanded.value]).toEqual(['/books', '/books/Ebooks'])
    expect(tree.focus.value).toBe('/books/Ebooks/Science Fiction')
  })
})
