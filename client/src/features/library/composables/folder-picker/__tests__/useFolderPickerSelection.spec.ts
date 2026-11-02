// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { ref, shallowReactive } from 'vue'
import type { FolderListing, FolderSummary, OrganizationMode } from '@bookorbit/types'
import type { PickerLibrary } from '../folder-picker-rules'
import type { FolderPickerData } from '../useFolderPickerData'
import { useFolderPickerSelection } from '../useFolderPickerSelection'

const novels: PickerLibrary = { id: 1, name: 'Novels', icon: null, folders: ['/books/Ebooks/Fiction'] }

function setup(options: { own?: string[]; denied?: string[]; uncounted?: string[] } = {}) {
  const listings = shallowReactive(new Map<string, FolderListing>())
  const summaries = shallowReactive(new Map<string, FolderSummary>())
  for (const path of options.denied ?? []) listings.set(path, { path, state: 'denied', entries: [], truncated: false })
  const tree: Record<string, string[]> = {
    '/books': ['/books/Ebooks', '/books/Unsorted', '/books/Periodicals'],
    '/books/Ebooks': ['/books/Ebooks/Fiction', '/books/Ebooks/Science Fiction', '/books/Ebooks/Cookbooks'],
  }
  const files: Record<string, number> = {
    '/books/Unsorted': 12,
    '/books/Periodicals': 0,
    '/books/Ebooks/Science Fiction': 45,
    '/books/Ebooks/Cookbooks': 8,
  }
  const data = {
    listings,
    summaries,
    ensureListing: vi.fn<(path: string) => Promise<FolderListing>>(async (path: string) => ({
      path,
      state: 'ok' as const,
      truncated: false,
      entries: (tree[path] ?? []).map((child) => ({
        name: child.split('/').pop()!,
        path: child,
        mount: false,
        system: false,
        appData: false,
        hasChildren: true,
      })),
    })),
    summariesFor: vi.fn<(paths: string[]) => Promise<Map<string, FolderSummary>>>(
      async (paths: string[]) =>
        new Map(paths.filter((path) => !options.uncounted?.includes(path)).map((path) => [path, { files: files[path] ?? 0 } as FolderSummary])),
    ),
  } as unknown as FolderPickerData
  const mode = ref<OrganizationMode>('book_per_folder')
  const onModeChange = vi.fn<(mode: OrganizationMode) => void>()
  const selection = useFolderPickerSelection({
    data,
    own: () => options.own ?? [],
    others: () => [novels],
    appDataPath: () => '/data',
    mode,
    onModeChange,
  })
  return { selection, mode, onModeChange, data }
}

describe('useFolderPickerSelection', () => {
  it('ticks and unticks folders', () => {
    const { selection } = setup()

    selection.toggle('/books/Unsorted')
    selection.toggle('/media/nas/')
    expect(selection.selected.value).toEqual(['/books/Unsorted', '/media/nas'])

    selection.toggle('/books/Unsorted')
    expect(selection.selected.value).toEqual(['/media/nas'])
  })

  it('refuses unreadable folders, the data folder and this library’s own folders, saying why', () => {
    const { selection } = setup({ own: ['/books/Ebooks/Science Fiction'], denied: ['/media/locked'] })

    selection.toggle('/media/locked')
    expect(selection.notice.value).toEqual({ key: 'library.folderBrowser.reason.denied' })
    selection.toggle('/data/covers')
    expect(selection.notice.value).toEqual({ key: 'library.folderBrowser.reason.appData' })
    selection.toggle('/books/Ebooks/Science Fiction')
    expect(selection.notice.value).toMatchObject({ key: 'library.folderBrowser.reason.own' })
    expect(selection.selected.value).toEqual([])
  })

  it('says when ticking a parent folds earlier picks into it', () => {
    const { selection } = setup()
    selection.toggle('/books/Ebooks/Cookbooks')

    selection.toggle('/books/Ebooks')

    expect(selection.selected.value).toEqual(['/books/Ebooks'])
    expect(selection.notice.value).toEqual({
      key: 'library.folderBrowser.notice.folded',
      params: { path: '/books/Ebooks', count: 1, name: 'Cookbooks' },
    })
  })

  it('ticks the run of siblings from the last ticked folder, skipping refused ones', () => {
    const { selection } = setup({ denied: ['/books/b'] })
    const siblings = ['/books/a', '/books/b', '/books/c', '/books/d']
    selection.toggle('/books/a')

    selection.tickRange('/books/d', siblings)

    expect(selection.selected.value).toEqual(['/books/a', '/books/c', '/books/d'])
    expect(selection.notice.value).toMatchObject({ key: 'library.folderBrowser.notice.range', params: { count: 2, from: 'a', to: 'd' } })
  })

  it('says why a folder inside one of this library’s folders cannot be ticked', () => {
    const { selection } = setup({ own: ['/books/Ebooks'] })

    selection.toggle('/books/Ebooks/Cookbooks')

    expect(selection.notice.value).toEqual({ key: 'library.folderBrowser.reason.ownCovered', params: { path: '/books/Ebooks' } })
  })

  it('undoes a removal and a mode switch', () => {
    const { selection, mode, onModeChange } = setup()
    selection.toggle('/books/Unsorted')

    selection.setMode('book_per_file')
    expect(mode.value).toBe('book_per_file')
    expect(onModeChange).toHaveBeenLastCalledWith('book_per_file')

    selection.restore()
    expect(mode.value).toBe('book_per_folder')
    expect(onModeChange).toHaveBeenLastCalledWith('book_per_folder')

    selection.remove('/books/Unsorted')
    expect(selection.undo.value?.notice).toEqual({ key: 'library.folderBrowser.notice.removed', params: { name: 'Unsorted' } })
    selection.restore()
    expect(selection.selected.value).toEqual(['/books/Unsorted'])
  })

  it('leaves out what another library reads, keeping the folders around it that hold books', async () => {
    const { selection } = setup()
    selection.toggle('/books')

    await selection.leaveOut('/books')

    expect(selection.selected.value).toEqual(['/books/Ebooks/Cookbooks', '/books/Ebooks/Science Fiction', '/books/Unsorted'])
    expect(selection.undo.value?.notice).toEqual({ key: 'library.folderBrowser.notice.leftOut', params: { name: 'books', count: 3 } })
  })

  it('leaves out once when asked twice at the same time', async () => {
    const { selection } = setup()
    selection.toggle('/books')

    await Promise.all([selection.leaveOut('/books'), selection.leaveOut('/books')])

    expect(selection.selected.value).toEqual(['/books/Ebooks/Cookbooks', '/books/Ebooks/Science Fiction', '/books/Unsorted'])
  })

  it('keeps a folder whose count could not be had rather than dropping its books', async () => {
    const { selection } = setup({ uncounted: ['/books/Periodicals'] })
    selection.toggle('/books')

    await selection.leaveOut('/books')

    expect(selection.selected.value).toContain('/books/Periodicals')
  })
})
