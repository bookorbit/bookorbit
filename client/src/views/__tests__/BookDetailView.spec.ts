import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, reactive, ref, type PropType } from 'vue'
import { mount } from '@vue/test-utils'
import type { BookDetail, BookLinksChangedEvent, BookMergedEvent, BookProgressChangedEvent } from '@bookorbit/types'
import BookDetailView from '../BookDetailView.vue'

const mockState = vi.hoisted(() => ({
  route: null as unknown as { params: { bookId: string }; query: Record<string, unknown> },
  detail: null as unknown as { value: BookDetail | null },
  loading: null as unknown as { value: boolean },
  notFound: null as unknown as { value: boolean },
  mergedInto: null as unknown as { value: number | null },
  libraries: null as unknown as { value: { id: number; accessLevel: string }[] },
  fetch: vi.fn<(bookId: number) => void>(),
  progressChangedCallback: null as ((event: BookProgressChangedEvent) => void) | null,
  mergedCallback: null as ((event: BookMergedEvent) => void) | null,
  linksChangedCallback: null as ((event: BookLinksChangedEvent) => void) | null,
  replace: vi.fn<(location: unknown) => Promise<void>>(),
  toastInfo: vi.fn<(message: string) => void>(),
}))

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return {
    ...actual,
    useRoute: () => mockState.route,
    useRouter: () => ({ replace: mockState.replace }),
  }
})

vi.mock('@/features/book/composables/useBookDetail', () => ({
  useBookDetail: () => ({
    detail: mockState.detail,
    loading: mockState.loading,
    notFound: mockState.notFound,
    mergedInto: mockState.mergedInto,
    fetch: mockState.fetch,
  }),
}))

vi.mock('@/features/book/composables/useBookEvents', () => ({
  useBookEvents: () => ({
    onBookMissing: () => undefined,
    onBookRestored: () => undefined,
    onBookMoved: () => undefined,
    onBookTransferred: () => undefined,
    onBookProgressChanged: (callback: (event: BookProgressChangedEvent) => void) => {
      mockState.progressChangedCallback = callback
      return () => undefined
    },
    onBookMerged: (callback: (event: BookMergedEvent) => void) => {
      mockState.mergedCallback = callback
      return () => undefined
    },
    onBookLinksChanged: (callback: (event: BookLinksChangedEvent) => void) => {
      mockState.linksChangedCallback = callback
      return () => undefined
    },
  }),
}))

vi.mock('vue-sonner', () => ({
  toast: { info: mockState.toastInfo, success: vi.fn<() => void>(), warning: vi.fn<() => void>(), error: vi.fn<() => void>() },
}))

vi.mock('@/features/scanner/composables/useScanProgress', () => ({
  useScanProgress: () => ({ subscribeLibrary: vi.fn<() => void>() }),
}))

vi.mock('@/composables/usePageTitle', () => ({
  usePageTitle: () => undefined,
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true, isSuperuser: { value: false } }),
}))

vi.mock('@/features/library/composables/useLibraries', async () => {
  const { ref } = await import('vue')
  const libraries = ref([{ id: 1, accessLevel: 'editor' }])
  mockState.libraries = libraries
  return { useLibraries: () => ({ libraries }) }
})

function makeBook(overrides: Partial<BookDetail> = {}): BookDetail {
  return {
    id: 217,
    libraryId: 1,
    libraryName: 'Test Library',
    status: 'present',
    folderPath: '/books',
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    title: 'Rating Test',
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
    rating: 2,
    personalNote: null,
    personalNoteUpdatedAt: null,
    communityRatings: [],
    coverSource: null,
    coverMedia: [],
    covers: { ebook: null, audio: null },
    coverVersion: 'legacy:2024-01-01T00:00:00.000Z',
    hardcoverEditionId: null,
    providerIds: {},
    authors: [],
    genres: [],
    tags: [],
    files: [],
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

const DetailsTabStub = defineComponent({
  name: 'DetailsTab',
  props: {
    book: {
      type: Object as PropType<BookDetail>,
      required: true,
    },
  },
  emits: ['saved', 'links-changed'],
  setup(props, { emit }) {
    function emitSaved() {
      emit('saved', { ...props.book, rating: 4 })
    }
    function emitLinksChanged() {
      emit('links-changed')
    }
    return { emitSaved, emitLinksChanged }
  },
  template: `
    <div>
      <div data-test="details-rating">{{ book.rating }}</div>
      <button data-test="details-save" @click="emitSaved">save</button>
      <button data-test="details-links-changed" @click="emitLinksChanged">links</button>
    </div>
  `,
})

const EditMetadataTabStub = defineComponent({
  name: 'EditMetadataTab',
  props: {
    book: {
      type: Object as PropType<BookDetail>,
      required: true,
    },
  },
  template: '<div data-test="edit-rating">{{ book.rating }}</div>',
})

describe('BookDetailView', () => {
  beforeEach(() => {
    mockState.route = reactive({
      params: { bookId: '217' },
      query: { tab: 'details' },
    })
    mockState.libraries.value = [{ id: 1, accessLevel: 'editor' }]
    mockState.detail = ref(makeBook())
    mockState.loading = ref(false)
    mockState.notFound = ref(false)
    mockState.mergedInto = ref(null)
    mockState.fetch.mockReset()
    mockState.progressChangedCallback = null
    mockState.mergedCallback = null
    mockState.linksChangedCallback = null
    mockState.replace.mockReset()
    mockState.replace.mockResolvedValue(undefined)
    mockState.toastInfo.mockReset()
  })

  it('hides the editor for a viewer even when the URL explicitly selects edit', async () => {
    mockState.libraries.value = [{ id: 1, accessLevel: 'viewer' }]
    mockState.route.query = { tab: 'edit' }
    const wrapper = mount(BookDetailView, {
      global: {
        stubs: {
          BookDetailLayout: { name: 'BookDetailLayout', props: ['canEditMetadata'], template: '<div><slot /></div>' },
          DetailsTab: DetailsTabStub,
          EditMetadataTab: EditMetadataTabStub,
          FilesTab: true,
        },
      },
    })
    expect(wrapper.find('[data-test="edit-rating"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="details-rating"]').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'BookDetailLayout' }).props('canEditMetadata')).toBe(false)
    mockState.libraries.value[0]!.accessLevel = 'owner'
    await nextTick()
    expect(wrapper.find('[data-test="edit-rating"]').exists()).toBe(true)
    mockState.libraries.value = []
    await nextTick()
    expect(wrapper.find('[data-test="edit-rating"]').exists()).toBe(false)
  })

  it('keeps updated rating when switching details -> edit -> details tabs', async () => {
    const wrapper = mount(BookDetailView, {
      global: {
        stubs: {
          BookDetailLayout: { template: '<div><slot /></div>' },
          DetailsTab: DetailsTabStub,
          EditMetadataTab: EditMetadataTabStub,
          FilesTab: { template: '<div />' },
        },
      },
    })

    expect(wrapper.get('[data-test="details-rating"]').text()).toBe('2')

    await wrapper.get('[data-test="details-save"]').trigger('click')
    await nextTick()
    expect(wrapper.get('[data-test="details-rating"]').text()).toBe('4')

    mockState.route.query = { tab: 'edit' }
    await nextTick()
    expect(wrapper.get('[data-test="edit-rating"]').text()).toBe('4')

    mockState.route.query = { tab: 'details' }
    await nextTick()
    expect(wrapper.get('[data-test="details-rating"]').text()).toBe('4')
  })

  it('clears the old detail view while a new route fetch is in flight', async () => {
    mockState.fetch.mockImplementation((bookId: number) => {
      if (bookId !== 218) return

      mockState.detail.value = null
      mockState.loading.value = true

      setTimeout(() => {
        mockState.detail.value = makeBook({ id: 218, rating: null, readStatus: null, title: 'Next Book' })
        mockState.loading.value = false
      }, 0)
    })

    const wrapper = mount(BookDetailView, {
      global: {
        stubs: {
          BookDetailLayout: { template: '<div><slot /></div>' },
          DetailsTab: DetailsTabStub,
          EditMetadataTab: EditMetadataTabStub,
          FilesTab: { template: '<div />' },
          EntityNotFound: { template: '<div data-test="not-found" />' },
        },
      },
    })

    expect(wrapper.get('[data-test="details-rating"]').text()).toBe('2')

    mockState.route.params.bookId = '218'
    await nextTick()

    expect(wrapper.find('[data-test="details-rating"]').exists()).toBe(false)
    expect(wrapper.find('.animate-shimmer').exists()).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()

    expect(mockState.fetch).toHaveBeenCalledWith(218)
    expect(wrapper.get('[data-test="details-rating"]').text()).toBe('')
  })

  it('refetches the open book when external reader progress changes', () => {
    mount(BookDetailView, {
      global: {
        stubs: {
          BookDetailLayout: { template: '<div><slot /></div>' },
          DetailsTab: DetailsTabStub,
          EditMetadataTab: EditMetadataTabStub,
          FilesTab: { template: '<div />' },
        },
      },
    })
    mockState.fetch.mockClear()

    mockState.progressChangedCallback?.({ bookId: 999, progress: 40, source: 'koreader' })
    expect(mockState.fetch).not.toHaveBeenCalled()

    mockState.progressChangedCallback?.({ bookId: 217, progress: 61.02, source: 'koreader' })
    expect(mockState.fetch).toHaveBeenCalledExactlyOnceWith(217)
  })
  const defaultStubs = {
    BookDetailLayout: { template: '<div><slot /></div>' },
    DetailsTab: DetailsTabStub,
    EditMetadataTab: EditMetadataTabStub,
    FilesTab: { template: '<div />' },
  }

  it('replaces the URL with the kept book when the open id was merged away', async () => {
    mockState.route.query = { tab: 'files' }
    mount(BookDetailView, { global: { stubs: defaultStubs } })

    mockState.mergedInto.value = 512
    await nextTick()

    expect(mockState.replace).toHaveBeenCalledExactlyOnceWith({ name: 'book-detail', params: { bookId: 512 }, query: { tab: 'files' } })
    expect(mockState.toastInfo).toHaveBeenCalledOnce()
  })

  it('follows a merge event that retires the open book and refetches when it is the kept book', async () => {
    mount(BookDetailView, { global: { stubs: defaultStubs } })
    mockState.fetch.mockClear()
    const event: BookMergedEvent = { libraryId: 1, targetBookId: 300, sourceBookIds: [217, 218] }

    mockState.mergedCallback?.(event)
    mockState.mergedCallback?.(event)
    expect(mockState.replace).toHaveBeenCalledOnce()
    expect(mockState.replace).toHaveBeenCalledWith(expect.objectContaining({ params: { bookId: 300 } }))

    mockState.mergedCallback?.({ libraryId: 1, targetBookId: 217, sourceBookIds: [5] })
    expect(mockState.fetch).toHaveBeenCalledExactlyOnceWith(217)

    mockState.mergedCallback?.({ libraryId: 1, targetBookId: 9, sourceBookIds: [10] })
    expect(mockState.fetch).toHaveBeenCalledOnce()
    expect(mockState.replace).toHaveBeenCalledOnce()
  })

  it('refetches when a link change names the open book or a book linked with it', () => {
    mockState.detail.value = makeBook({
      linkGroupId: 4,
      linkedBooks: [
        {
          bookId: 900,
          libraryId: 2,
          libraryName: 'Audiobooks',
          title: 'Rating Test',
          formats: ['m4b'],
          mediaKind: 'audiobook',
          status: 'present',
          isLead: false,
        },
      ],
    })
    mount(BookDetailView, { global: { stubs: defaultStubs } })
    mockState.fetch.mockClear()

    mockState.linksChangedCallback?.({ libraryId: 3, bookIds: [40, 41] })
    expect(mockState.fetch).not.toHaveBeenCalled()

    mockState.linksChangedCallback?.({ libraryId: 2, bookIds: [900, 901] })
    expect(mockState.fetch).toHaveBeenCalledExactlyOnceWith(217)

    mockState.linksChangedCallback?.({ libraryId: 1, bookIds: [217, 55] })
    expect(mockState.fetch).toHaveBeenCalledTimes(2)
  })

  it('refetches after the details tab links or unlinks the book', async () => {
    const wrapper = mount(BookDetailView, { global: { stubs: defaultStubs } })
    mockState.fetch.mockClear()

    await wrapper.get('[data-test="details-links-changed"]').trigger('click')

    expect(mockState.fetch).toHaveBeenCalledExactlyOnceWith(217)
  })
})
