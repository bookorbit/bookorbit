import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { LibraryStats } from '@bookorbit/types'
import type { FolderCheck } from '../../composables/useLibraryCreator'
import LibraryCreatorFolders from '../LibraryCreatorFolders.vue'

describe('LibraryCreatorFolders', () => {
  it('adds a pasted path from the always-visible path field', async () => {
    const wrapper = mountFolders()

    await wrapper.get('#manual-folder-path').setValue('/books/fiction')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('update:folders')).toEqual([[['/books/fiction']]])
  })

  it('rejects a relative path with a message tied to the field', async () => {
    const wrapper = mountFolders()

    await wrapper.get('#manual-folder-path').setValue('books')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('update:folders')).toBeUndefined()
    expect(wrapper.get('#manual-folder-error').text()).toBe('Enter an absolute server path beginning with /.')
    expect(wrapper.get('#manual-folder-path').attributes('aria-describedby')).toBe('manual-folder-error')
  })

  it('shows each folder check beside its folder', () => {
    const wrapper = mountFolders({
      folders: ['/books/fantasy', '/books/comics', '/books/missing', '/books/new'],
      checks: {
        '/books/fantasy': { state: 'checked', accessible: true, fileCount: 1250 },
        '/books/comics': { state: 'checked', accessible: true, fileCount: 11, overlapLibrary: 'Comics' },
        '/books/missing': { state: 'checked', accessible: false, fileCount: 0 },
        '/books/new': { state: 'checking' },
      },
    })

    const rows = wrapper.findAll('li')
    expect(rows[0]!.text()).toContain('1,250 files')
    expect(rows[1]!.text()).toContain('Also in Comics')
    expect(rows[2]!.text()).toContain('Not accessible')
    expect(rows[3]!.text()).toContain('Checking')
    expect(wrapper.text()).toContain('1,261 matching files')
  })

  it('bolds the folder name and keeps the parent path quiet', () => {
    const wrapper = mountFolders({ folders: ['/mnt/media/books/Novels'] })
    const path = wrapper.get('li p')

    expect(path.findAll('span').map((span) => span.text())).toEqual(['/mnt/media/books/', 'Novels'])
  })

  it('asks for a recheck of one folder after a failed check', async () => {
    const wrapper = mountFolders({ folders: ['/books'], checks: { '/books': { state: 'failed' } } })

    await wrapper.get('button[aria-label="Check /books again"]').trigger('click')

    expect(wrapper.emitted('check')).toEqual([[['/books']]])
  })

  it('shows what an existing library holds before any folder is rechecked', () => {
    const stats: LibraryStats = { totalBooks: 455, totalSizeBytes: 787_300_000, formatCounts: { epub: 378, pdf: 6 } }
    const wrapper = mountFolders({ folders: ['/books'], stats })

    expect(wrapper.text()).toContain('455 books')
    expect(wrapper.text()).toContain('EPUB')
  })

  it('offers existing podcast folders only for podcast libraries', () => {
    expect(mountFolders({ libraryType: 'books' }).text()).not.toContain('Existing podcast folders')
    expect(mountFolders({ libraryType: 'podcasts' }).text()).toContain('Existing podcast folders')
  })

  it('stops offering to add once a podcast library has its storage folder', () => {
    expect(
      mountFolders({ libraryType: 'podcasts', folders: ['/podcasts'] })
        .find('#manual-folder-path')
        .exists(),
    ).toBe(false)
  })

  it('reports the podcast local folders it was given as removable rows', () => {
    const wrapper = mountFolders({ libraryType: 'podcasts', folders: ['/podcasts'], localFolders: ['/archive/shows'] })

    expect(wrapper.text()).toContain('/archive/shows')
    expect(wrapper.find('button[aria-label="Remove /archive/shows"]').exists()).toBe(true)
  })
})

function mountFolders(
  props: {
    folders?: string[]
    localFolders?: string[]
    libraryType?: 'books' | 'podcasts'
    checks?: Record<string, FolderCheck>
    stats?: LibraryStats | null
  } = {},
) {
  return mount(LibraryCreatorFolders, {
    props: {
      folders: props.folders ?? [],
      localFolders: props.localFolders ?? [],
      libraryType: props.libraryType ?? 'books',
      checks: props.checks ?? {},
      stats: props.stats ?? null,
    },
    global: {
      stubs: {
        FolderPickerModal: true,
      },
    },
  })
}
