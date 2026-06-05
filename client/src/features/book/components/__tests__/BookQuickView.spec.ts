import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { BookDetail } from '@bookorbit/types'
import BookQuickView from '../BookQuickView.vue'

const displaySettings = {
  bookCoverDisplayMode: ref('blurred-fit'),
}

const permissionState = {
  canDelete: true,
  canEditMetadata: true,
}

const fetchMock = vi.fn<(bookId: number) => void>()
const pushMock = vi.fn<(...args: unknown[]) => unknown>()

const detailRef = ref<BookDetail | null>(null)
const loadingRef = ref(false)

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return {
    ...actual,
    useRouter: () => ({
      push: pushMock,
    }),
  }
})

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: (name: string) => {
      if (name === 'library_delete_books') return permissionState.canDelete
      if (name === 'library_edit_metadata') return permissionState.canEditMetadata
      return true
    },
  }),
}))

vi.mock('@/features/book/composables/useBookDetail', () => ({
  useBookDetail: () => ({
    detail: detailRef,
    loading: loadingRef,
    fetch: fetchMock,
  }),
}))

vi.mock('@/features/book/composables/useCoverVersions', () => ({
  useCoverVersions: () => ({
    coverUrl: () => '/cover.jpg',
  }),
}))

vi.mock('@/features/book/composables/useSafeHtml', () => ({
  useSafeHtml: () => '',
}))

vi.mock('@/composables/useDisplaySettings', () => ({
  useDisplaySettings: () => displaySettings,
}))

function makeDetail(overrides: Partial<BookDetail> = {}): BookDetail {
  return {
    id: 42,
    libraryId: 1,
    libraryName: 'Library',
    status: 'present',
    folderPath: '/books',
    addedAt: '2026-01-01T00:00:00.000Z',
    title: 'Quick View Book',
    subtitle: null,
    description: null,
    isbn10: null,
    isbn13: null,
    publisher: null,
    publishedYear: null,
    language: null,
    pageCount: null,
    seriesName: null,
    seriesIndex: null,
    rating: null,
    coverSource: null,
    providerIds: {},
    authors: [],
    genres: [],
    tags: [],
    files: [
      {
        id: 11,
        role: 'primary',
        format: 'EPUB',
        filename: 'book.epub',
        sizeBytes: 1024,
        absolutePath: '/books/book.epub',
        createdAt: '2026-01-01T00:00:00.000Z',
        durationSeconds: null,
      },
    ],
    lastWrittenAt: null,
    metadataScore: null,
    readStatus: null,
    audioMetadata: null,
    formatPriority: [],
    comicMetadata: null,
    lockedFields: [],
    collections: [],
    ...overrides,
  }
}

const globalStubs = {
  stubs: {
    Sheet: { template: '<div><slot /></div>' },
    SheetContent: { template: '<div><slot /></div>' },
    SheetTitle: { template: '<div><slot /></div>' },
    SheetDescription: { template: '<div><slot /></div>' },
    TooltipProvider: { template: '<div><slot /></div>' },
    Tooltip: { template: '<div><slot /></div>' },
    TooltipTrigger: { template: '<div><slot /></div>' },
    TooltipContent: { template: '<div><slot /></div>' },
    DialogRoot: { template: '<div><slot /></div>' },
    DialogPortal: { template: '<div><slot /></div>' },
    DialogOverlay: { template: '<div />' },
    DialogContent: { template: '<div><slot /></div>' },
    DialogTitle: { template: '<div><slot /></div>' },
    DialogDescription: { template: '<div><slot /></div>' },
    DialogClose: { template: '<button><slot /></button>' },
    BookCoverPlaceholder: { template: '<div />' },
    Skeleton: { template: '<div />' },
  },
}

describe('BookQuickView', () => {
  beforeEach(() => {
    permissionState.canDelete = true
    permissionState.canEditMetadata = true
    fetchMock.mockReset()
    pushMock.mockReset()
    loadingRef.value = false
    displaySettings.bookCoverDisplayMode.value = 'blurred-fit'
    detailRef.value = makeDetail()
  })

  it('fetches detail when mounted with a book id', () => {
    mount(BookQuickView, {
      props: {
        open: true,
        bookId: 42,
      },
      global: globalStubs,
    })

    expect(fetchMock).toHaveBeenCalledWith(42)
  })

  it('emits close and add-to-collection action from the add button', async () => {
    const wrapper = mount(BookQuickView, {
      props: {
        open: true,
        bookId: 42,
      },
      global: globalStubs,
    })

    await wrapper.get('[data-testid="quick-view-action-add-to-collection"]').trigger('click')

    expect(wrapper.emitted('update:open')).toEqual([[false]])
    expect(wrapper.emitted('action')).toEqual([['add-to-collection']])
  })

  it('emits close and delete action from the delete button', async () => {
    const wrapper = mount(BookQuickView, {
      props: {
        open: true,
        bookId: 42,
      },
      global: globalStubs,
    })

    await wrapper.get('[data-testid="quick-view-action-delete"]').trigger('click')

    expect(wrapper.emitted('update:open')).toEqual([[false]])
    expect(wrapper.emitted('action')).toEqual([['delete']])
  })

  it('hides delete action when delete permission is missing', () => {
    permissionState.canDelete = false

    const wrapper = mount(BookQuickView, {
      props: {
        open: true,
        bookId: 42,
      },
      global: globalStubs,
    })

    expect(wrapper.find('[data-testid="quick-view-action-delete"]').exists()).toBe(false)
  })

  it('renders RanobeDB provider icon link', () => {
    detailRef.value = makeDetail({
      providerIds: {
        ranobedb: '1287',
      },
    })

    const wrapper = mount(BookQuickView, {
      props: {
        open: true,
        bookId: 42,
      },
      global: globalStubs,
    })

    const ranobedbLink = wrapper.find('a[title="Open in RanobeDB"]')
    expect(ranobedbLink.exists()).toBe(true)
    expect(ranobedbLink.attributes('href')).toBe('https://ranobedb.org/book/1287')
    expect(ranobedbLink.find('img[alt="RanobeDB"][src="/assets/provider-icons/ranobedb.svg"]').exists()).toBe(true)
  })

  it('shrinks natural-bottom quick-view cover to the loaded cover ratio', async () => {
    displaySettings.bookCoverDisplayMode.value = 'natural-bottom'
    detailRef.value = makeDetail({ coverSource: 'extracted' })

    const wrapper = mount(BookQuickView, {
      props: {
        open: true,
        bookId: 42,
      },
      global: globalStubs,
    })
    const image = wrapper.get('img[alt="Quick View Book"]')
    Object.defineProperty(image.element, 'naturalWidth', { configurable: true, value: 1200 })
    Object.defineProperty(image.element, 'naturalHeight', { configurable: true, value: 600 })

    await image.trigger('load')

    const surface = wrapper.get('.book-cover-surface')
    expect(surface.attributes('style')).toContain('aspect-ratio: 2 / 1')
  })
})
