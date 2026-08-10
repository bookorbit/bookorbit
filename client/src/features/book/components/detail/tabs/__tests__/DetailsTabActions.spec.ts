import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import type { BookDetail } from '@bookorbit/types'

const mocks = vi.hoisted(() => ({
  push: vi.fn<(to: unknown) => void>(),
  back: vi.fn<() => void>(),
  hasPermission: vi.fn<(permission: string) => boolean>(),
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  onDeleted: null as ((id: number) => void) | null,
}))

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return { ...actual, useRouter: () => ({ push: mocks.push, back: mocks.back }) }
})

vi.mock('@/lib/api', () => ({ api: mocks.api, setOnAuthFailure: vi.fn<(callback: () => void) => void>() }))
vi.mock('@/features/auth/composables/usePermissions', () => ({ usePermissions: () => ({ hasPermission: mocks.hasPermission }) }))

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

function mountTab() {
  return shallowMount(DetailsTab, {
    props: { book: makeBook() },
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
