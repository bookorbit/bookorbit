import { flushPromises, mount, shallowMount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { BookDockFile, BookDockUnitFile } from '@bookorbit/types'

import { formatList } from '@/i18n/formatters'
import BookDockFileRow from '../BookDockFileRow.vue'

const { keepBothMock } = vi.hoisted(() => ({ keepBothMock: vi.fn<(id: number) => Promise<{ ok: boolean; errorCode?: string | null }>>() }))
vi.mock('../../api/book-dock.api', () => ({ keepBookDockDuplicate: keepBothMock }))

function unitFile(overrides: Partial<BookDockUnitFile> = {}): BookDockUnitFile {
  return { fileName: 'track-01.mp3', fileSize: 1024, format: 'mp3', role: 'content', sortOrder: 0, ...overrides }
}

function file(overrides: Partial<BookDockFile> = {}): BookDockFile {
  return {
    id: 1,
    fileName: 'track-01.mp3',
    fileSize: 1024,
    format: 'mp3',
    status: 'ready',
    embeddedMetadata: { title: 'Neuromancer', authors: ['William Gibson'] },
    selectedMetadata: null,
    fetchedMetadata: null,
    targetLibraryId: 2,
    targetFolderId: 3,
    confidence: 90,
    fetchedMetadataSources: null,
    errorMessage: null,
    metadataEditedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    unitFiles: [],
    ...overrides,
  }
}

function mountStatusRow(status: BookDockFile['status']) {
  return shallowMount(BookDockFileRow, {
    props: {
      file: file({
        id: 42,
        fileName: 'book.epub',
        format: 'epub',
        status,
        embeddedMetadata: { title: 'Book' },
        targetLibraryId: null,
        targetFolderId: null,
        confidence: null,
      }),
      selected: false,
      expanded: false,
      focused: false,
      libraryName: null,
      targetLabel: 'Unassigned',
    },
  })
}

function mountUnitRow(overrides: Partial<BookDockFile> = {}, expanded = false) {
  return mount(BookDockFileRow, {
    props: {
      file: file(overrides),
      selected: false,
      expanded,
      focused: false,
      libraryName: 'Books',
      targetLabel: 'Books / Audiobooks',
    },
  })
}

describe('BookDockFileRow metadata refetch action', () => {
  it.each(['ready', 'error'] as const)('emits retry for a %s file', async (status) => {
    const wrapper = mountStatusRow(status)

    await wrapper.get('[data-testid="book-dock-row-retry"]').trigger('click')

    expect(wrapper.emitted('retry')).toEqual([[expect.objectContaining({ id: 42, status })]])
  })

  it.each(['pending', 'extracting', 'fetching'] as const)('disables refetch while a file is %s', (status) => {
    const wrapper = mountStatusRow(status)

    expect(wrapper.get('[data-testid="book-dock-row-retry"]').attributes('disabled')).toBeDefined()
  })

  it('requests confirmation instead of deleting from the row', async () => {
    const wrapper = mountStatusRow('ready')

    await wrapper.get('[data-testid="book-dock-row-discard"]').trigger('click')

    expect(wrapper.emitted('discard')).toEqual([[expect.objectContaining({ id: 42 })]])
  })
})

describe('BookDockFileRow match badge', () => {
  it('shows a zero score for a fetched result instead of calling it no match', () => {
    const text = mountUnitRow({ fetchedMetadata: { title: 'Another Book' }, confidence: 0 }).text()

    expect(text).toContain('0% match')
    expect(text).not.toContain('No match')
  })

  it('reports no match when nothing was fetched', () => {
    const text = mountUnitRow({ confidence: null }).text()

    expect(text).toContain('No match')
    expect(text).not.toContain('% match')
  })
})

describe('BookDockFileRow with a multi-file unit', () => {
  const TRACKS = [
    unitFile({ fileName: 'track-01.mp3', sortOrder: 0 }),
    unitFile({ fileName: 'track-02.mp3', sortOrder: 1 }),
    unitFile({ fileName: 'cover.jpg', format: 'jpg', role: 'cover', sortOrder: null, fileSize: 512 }),
  ]

  /** The row is named after its primary file, so without the badge it reads as a single mp3. */
  it('badges the row with how many files the entry actually holds', () => {
    expect(mountUnitRow({ unitFiles: TRACKS }).text()).toContain('3 files')
  })

  it('leaves an ordinary single file unbadged', () => {
    expect(mountUnitRow().text()).not.toContain('3 files')
  })

  /** The anchor row's own size is one track's; the row must show what the whole unit weighs. */
  it('sums the unit size rather than reporting the primary file alone', () => {
    expect(mountUnitRow({ unitFiles: TRACKS }).text()).toContain('2.5 kB')
  })

  it('lists the unit files in order with their roles once expanded', () => {
    const text = mountUnitRow({ unitFiles: TRACKS }, true).text()

    expect(text).toContain('3 files in this entry')
    expect(text).toContain('track-01.mp3')
    expect(text).toContain('track-02.mp3')
    expect(text).toContain('Cover')
    expect(text.indexOf('track-01.mp3')).toBeLessThan(text.indexOf('track-02.mp3'))
  })

  /** A unit is filed whole, so "finalize track 7 of 31" must not be expressible. */
  it('offers no per-file control in the expanded list', () => {
    const wrapper = mountUnitRow({ unitFiles: TRACKS }, true)
    const list = wrapper.get('ol')

    expect(list.findAll('button')).toHaveLength(0)
    expect(list.findAll('input')).toHaveLength(0)
  })
})

describe('BookDockFileRow holds', () => {
  function mountHeld(overrides: Partial<BookDockFile>, options: { canManage?: boolean; expanded?: boolean } = {}) {
    return mount(BookDockFileRow, {
      props: {
        file: file({ fileName: 'dune.epub', format: 'epub', embeddedMetadata: { title: 'Dune' }, ...overrides }),
        selected: false,
        expanded: options.expanded ?? false,
        focused: false,
        libraryName: 'Fiction',
        targetLabel: 'Target: Fiction',
        canManage: options.canManage ?? false,
      },
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
  }

  it('says why a file waits, with the facts the server sent', () => {
    const wrapper = mountHeld({ holdReason: 'low_confidence', holdDetail: { confidence: 72, threshold: 85 }, confidence: 72 })

    expect(wrapper.get('[data-testid="book-dock-row-hold"]').text()).toBe('72% match, needs 85%')
    // The chip already gives the score, so the match badge is not repeated.
    expect(wrapper.text()).not.toContain('72% match ')
    expect(wrapper.find('.row-file').exists()).toBe(true)
  })

  it('reads a reason this client does not know as a plain wait', () => {
    const wrapper = mountHeld({ holdReason: 'a_future_reason' as never })

    expect(wrapper.get('[data-testid="book-dock-row-hold"]').text()).toBe('Waiting for review')
  })

  it.each([
    ['not_allowed_in_library', 'Move to…'],
    ['no_folder', 'Choose a folder'],
    ['no_destination', 'Set destination'],
  ] as const)('turns the destination button into the fix for %s, and holds back File', (holdReason, label) => {
    const wrapper = mountHeld({ holdReason, holdDetail: { libraryName: 'Fiction' } })

    expect(wrapper.get('[data-testid="book-dock-row-destination"]').text()).toBe(label)
    expect(wrapper.find('.row-file').exists()).toBe(false)
  })

  it('locks a file waiting for a manager for anyone else, and lets a manager file it', () => {
    const member = mountHeld({ holdReason: 'waiting_for_manager' })
    expect(member.find('[data-testid="book-dock-row-locked"]').exists()).toBe(true)
    expect(member.find('.row-file').exists()).toBe(false)

    const manager = mountHeld({ holdReason: 'waiting_for_manager' }, { canManage: true })
    expect(manager.find('[data-testid="book-dock-row-locked"]').exists()).toBe(false)
    expect(manager.find('.row-file').exists()).toBe(true)
  })

  it('notes other libraries that hold the book and a library that was deleted', () => {
    const wrapper = mountHeld({ alsoIn: ['Audiobooks', 'Kids'], formerLibraryName: 'Sci-fi' })

    expect(wrapper.get('[data-testid="book-dock-row-also-in"]').text()).toBe(`Also in ${formatList(['Audiobooks', 'Kids'])}`)
    expect(wrapper.get('[data-testid="book-dock-row-former-library"]').text()).toBe('From deleted library Sci-fi')
  })

  it('resolves a duplicate in the row: add as format files it, keep both is for managers', async () => {
    keepBothMock.mockResolvedValue({ ok: true })
    const duplicate = { holdReason: 'duplicate' as const, holdDetail: { libraryName: 'Fiction', bookId: 9 } }
    const member = mountHeld(duplicate, { expanded: true })
    expect(member.find('[data-testid="book-dock-row-keep-both"]').exists()).toBe(false)
    await member.get('[data-testid="book-dock-row-add-format"]').trigger('click')
    expect(member.emitted('file')).toHaveLength(1)

    const manager = mountHeld(duplicate, { expanded: true, canManage: true })
    expect(manager.get('[data-testid="book-dock-row-resolve"]').text()).toBe('Resolve')
    await manager.get('[data-testid="book-dock-row-keep-both"]').trigger('click')
    await flushPromises()

    expect(keepBothMock).toHaveBeenCalledWith(1)
    expect(manager.emitted('changed')).toHaveLength(1)
  })
})
