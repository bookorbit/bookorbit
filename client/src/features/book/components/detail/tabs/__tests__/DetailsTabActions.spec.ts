import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import type { BookDetail, LinkedBookSummary } from '@bookorbit/types'

const mocks = vi.hoisted(() => ({
  push: vi.fn<(to: unknown) => void>(),
  back: vi.fn<() => void>(),
  hasPermission: vi.fn<(permission: string) => boolean>(),
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  onDeleted: null as ((id: number) => void) | null,
  libraries: null as unknown as { value: { id: number; accessLevel: string }[] },
}))

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return { ...actual, useRouter: () => ({ push: mocks.push, back: mocks.back }) }
})

vi.mock('@/lib/api', () => ({ api: mocks.api, setOnAuthFailure: vi.fn<(callback: () => void) => void>() }))
vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: mocks.hasPermission, isSuperuser: ref(false), isDemoRestrictedAccount: ref(false) }),
}))
vi.mock('@/features/library/composables/useLibraries', async () => {
  const { ref: vueRef } = await import('vue')
  mocks.libraries = vueRef([{ id: 3, accessLevel: 'editor' }])
  return { useLibraries: () => ({ libraries: mocks.libraries }) }
})

vi.mock('@/features/book/composables/useDeleteBook', () => ({
  useDeleteBook: (onDeleted: (id: number) => void) => {
    mocks.onDeleted = onDeleted
    return {
      pendingId: { value: null },
      deleting: { value: false },
      promptDelete: vi.fn<(id: number) => void>(),
      cancelDelete: vi.fn<() => void>(),
      confirmDelete: vi.fn<() => void>(),
    }
  },
}))

const DetailsTab = (await import('../DetailsTab.vue')).default

function makeBook(overrides: Partial<BookDetail> = {}): BookDetail {
  return {
    id: 12,
    libraryId: 3,
    libraryName: 'Novels',
    status: 'present',
    folderPath: '/books',
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    title: 'Cover Behavior Test',
    subtitle: null,
    description: null,
    isbn10: null,
    isbn13: null,
    publisher: null,
    publishedDate: null,
    publishedYear: null,
    language: null,
    pageCount: null,
    seriesName: null,
    seriesIndex: null,
    rating: null,
    personalNote: null,
    personalNoteUpdatedAt: null,
    communityRatings: [],
    coverSource: 'extracted',
    coverMedia: ['ebook'],
    covers: { ebook: null, audio: null },
    coverVersion: 'legacy:2024-01-01T00:00:00.000Z',
    hardcoverEditionId: null,
    providerIds: {},
    authors: [{ id: 1, name: 'Author One', sortName: null }],
    genres: [],
    tags: [],
    files: [
      {
        id: 101,
        format: 'epub',
        role: 'primary',
        sizeBytes: 1234,
        absolutePath: '/books/cover-behavior-test.epub',
        createdAt: '2026-01-01T00:00:00.000Z',
        filename: 'cover-behavior-test.epub',
        durationSeconds: null,
      },
    ],
    lastWrittenAt: null,
    metadataScore: null,
    readStatus: null,
    audioMetadata: null,
    readAloudSync: {
      mode: 'auto',
      state: 'unavailable',
      unavailableReason: 'no_media_overlay_epub',
      overlayFileId: null,
      audioDurationSeconds: null,
      overlayDurationSeconds: null,
      durationDifferenceSeconds: null,
      durationDifferenceRatio: null,
      koreaderDownloadAvailable: false,
    },
    formatPriority: [],
    comicMetadata: null,
    customMetadata: [],
    lockedFields: [],
    collections: [],
    ...overrides,
  }
}

function response(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as unknown as Response
}

function mountTab(overrides: Partial<BookDetail> = {}) {
  return shallowMount(DetailsTab, {
    props: { book: makeBook(overrides) },
    global: {
      stubs: {
        Popover: { template: '<div><slot /><slot name="content" /></div>' },
        PopoverTrigger: { template: '<div><slot /></div>' },
        PopoverContent: { template: '<div><slot /></div>' },
        Tooltip: { template: '<div><slot /></div>' },
        TooltipTrigger: { template: '<div><slot /></div>' },
        TooltipContent: { template: '<div><slot /></div>' },
      },
    },
  })
}

beforeEach(() => {
  mocks.push.mockReset()
  mocks.back.mockReset()
  mocks.api.mockReset().mockResolvedValue(response({}))
  mocks.hasPermission.mockReset().mockReturnValue(true)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  mocks.onDeleted = null
  mocks.libraries.value = [{ id: 3, accessLevel: 'editor' }]
})

describe('deleting from the detail page', () => {
  it('navigates to the dashboard instead of going back', () => {
    mountTab()

    mocks.onDeleted?.(12)

    // router.back() left the user on a detail page for a deleted book whenever
    // there was no previous entry, such as a deep link or a reload.
    expect(mocks.push).toHaveBeenCalledWith({ name: 'dashboard' })
    expect(mocks.back).not.toHaveBeenCalled()
  })
})

describe('moving from the detail page', () => {
  it('offers the destination sheet for the book being viewed', () => {
    const wrapper = mountTab()

    const sheet = wrapper.findComponent({ name: 'MoveToLibrarySheet' })
    expect(sheet.exists()).toBe(true)
    expect(sheet.props('selectionPayload')).toEqual({ bookIds: [12] })
    expect(sheet.props('selectedCount')).toBe(1)
    // Its own library is disabled in the picker.
    expect(sheet.props('currentLibraryId')).toBe(3)
  })

  it('starts closed and reports a completed move upward', async () => {
    const wrapper = mountTab()
    const sheet = wrapper.findComponent({ name: 'MoveToLibrarySheet' })

    expect(sheet.props('open')).toBe(false)

    await sheet.vm.$emit('moved')

    expect(wrapper.emitted('moved')).toHaveLength(1)
  })
})

function linkedBook(overrides: Partial<LinkedBookSummary> = {}): LinkedBookSummary {
  return {
    bookId: 40,
    libraryId: 5,
    libraryName: 'Audiobooks',
    title: 'Cover Behavior Test',
    formats: ['m4b'],
    mediaKind: 'audiobook',
    status: 'present',
    isLead: true,
    ...overrides,
  }
}

describe('linking from the detail page', () => {
  const linked = { linkGroupId: 4, linkedBooks: [linkedBook()] }

  function menuItems(wrapper: ReturnType<typeof mountTab>) {
    return {
      link: wrapper.find('[data-testid="detail-link-book"]'),
      unlink: wrapper.find('[data-testid="detail-unlink-book"]'),
      makeMain: wrapper.find('[data-testid="detail-make-main-book"]'),
    }
  }

  it('offers no link items without the merge permission', () => {
    mocks.hasPermission.mockImplementation((permission) => permission !== 'library_merge_books')
    const items = menuItems(mountTab(linked))
    expect(items.link.exists()).toBe(false)
    expect(items.unlink.exists()).toBe(false)
    expect(items.makeMain.exists()).toBe(false)
  })

  it('offers no link items to a viewer of the library', () => {
    mocks.libraries.value = [{ id: 3, accessLevel: 'viewer' }]
    const items = menuItems(mountTab(linked))
    expect(items.link.exists()).toBe(false)
    expect(items.unlink.exists()).toBe(false)
  })

  it('offers only linking for a book that is not linked yet', () => {
    const wrapper = mountTab()
    const items = menuItems(wrapper)
    expect(items.link.exists()).toBe(true)
    expect(items.unlink.exists()).toBe(false)
    expect(items.makeMain.exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'BookLinkedChips' }).exists()).toBe(false)
  })

  it('offers unlinking and making this the main book when another book leads', () => {
    const wrapper = mountTab(linked)
    const items = menuItems(wrapper)
    expect(items.link.exists()).toBe(true)
    expect(items.unlink.exists()).toBe(true)
    expect(items.makeMain.exists()).toBe(true)
    const chips = wrapper.findAllComponents({ name: 'BookLinkedChips' })
    expect(chips.length).toBeGreaterThan(0)
    expect(chips[0]!.props('books')).toEqual(linked.linkedBooks)
  })

  it('leaves out Make this the main book when no other visible book leads', () => {
    const items = menuItems(mountTab({ linkGroupId: 4, linkedBooks: [linkedBook({ isLead: false })] }))
    expect(items.unlink.exists()).toBe(true)
    expect(items.makeMain.exists()).toBe(false)
  })

  it('uses the server flag for the main book when it sends one', () => {
    const notLead = menuItems(mountTab({ linkGroupId: 4, linkIsLead: false, linkedBooks: [linkedBook({ isLead: false })] }))
    expect(notLead.makeMain.exists()).toBe(true)
    const lead = menuItems(mountTab({ linkGroupId: 4, linkIsLead: true, linkedBooks: [linkedBook({ isLead: false })] }))
    expect(lead.makeMain.exists()).toBe(false)
  })

  it('unlinks the open book and reports the change', async () => {
    const wrapper = mountTab(linked)
    mocks.api.mockResolvedValue({ ok: true, status: 204, json: async () => null } as unknown as Response)

    await menuItems(wrapper).unlink.trigger('click')
    await vi.waitFor(() => expect(wrapper.emitted('links-changed')).toHaveLength(1))

    expect(mocks.api).toHaveBeenCalledWith('/api/v1/books/12/link', expect.objectContaining({ method: 'DELETE' }))
  })

  it('makes the open book the main book of its group', async () => {
    const wrapper = mountTab(linked)
    mocks.api.mockResolvedValue(response({ groupId: 4, leadBookId: 12, books: [] }))

    await menuItems(wrapper).makeMain.trigger('click')
    await vi.waitFor(() => expect(wrapper.emitted('links-changed')).toHaveLength(1))

    const [url, init] = mocks.api.mock.calls.at(-1)!
    expect(url).toBe('/api/v1/books/links/4')
    expect(init).toEqual(expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ leadBookId: 12 }) }))
  })

  it('opens the link sheet with the open book and its linked books kept out of the search', async () => {
    const wrapper = mountTab(linked)
    expect(wrapper.findComponent({ name: 'LinkBooksSheet' }).exists()).toBe(false)

    await menuItems(wrapper).link.trigger('click')
    await nextTick()

    // The sheet loads on demand, so its stub carries what it was given as attributes.
    const sheet = wrapper.findComponent({ name: 'LinkBooksSheet' })
    expect(sheet.exists()).toBe(true)
    const attrs = sheet.vm.$attrs as Record<string, unknown>
    expect(attrs['book-ids'] ?? attrs.bookIds).toEqual([12])
    expect(attrs['exclude-ids'] ?? attrs.excludeIds).toEqual([40])
    expect(attrs.picker).not.toBe(false)
    expect(attrs.open).toBe(true)
  })

  it('hands a blocked merge to Link with the same books listed, not searched for again', async () => {
    const wrapper = mountTab()
    await wrapper.get('[data-testid="detail-merge-book"]').trigger('click')
    await nextTick()

    const seeds = [
      { id: 40, title: 'Dune', libraryId: 4, formats: ['m4b'] },
      { id: 12, title: 'Dune', libraryId: 3, formats: ['epub'] },
    ]
    wrapper.findComponent({ name: 'MergeBooksSheet' }).vm.$emit('link-instead', [40, 12], seeds)
    await nextTick()

    const attrs = wrapper.findComponent({ name: 'LinkBooksSheet' }).vm.$attrs as Record<string, unknown>
    expect(attrs['book-ids'] ?? attrs.bookIds).toEqual([40, 12])
    expect(attrs['seed-books'] ?? attrs.seedBooks).toEqual(seeds)
    expect(attrs.picker).toBe(false)
    expect(attrs.open).toBe(true)
    await vi.dynamicImportSettled()
  })

  it('tells the delete dialog that linked books stay', () => {
    expect(mountTab(linked).findComponent({ name: 'DeleteBookDialog' }).props('linked')).toBe(true)
    expect(mountTab().findComponent({ name: 'DeleteBookDialog' }).props('linked')).toBe(false)
  })
})
