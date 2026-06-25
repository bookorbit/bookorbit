import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, reactive, ref, type PropType } from 'vue'
import { mount } from '@vue/test-utils'
import type { BookDetail } from '@bookorbit/types'
import BookDetailView from '../BookDetailView.vue'

const mockState = vi.hoisted(() => ({
  route: null as unknown as { params: { bookId: string }; query: Record<string, unknown> },
  detail: null as unknown as { value: BookDetail | null },
  loading: null as unknown as { value: boolean },
  notFound: null as unknown as { value: boolean },
  fetch: vi.fn<(bookId: number) => void>(),
}))

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return {
    ...actual,
    useRoute: () => mockState.route,
  }
})

vi.mock('@/features/book/composables/useBookDetail', () => ({
  useBookDetail: () => ({
    detail: mockState.detail,
    loading: mockState.loading,
    notFound: mockState.notFound,
    fetch: mockState.fetch,
  }),
}))

vi.mock('@/features/book/composables/useBookEvents', () => ({
  useBookEvents: () => ({
    onBookMissing: () => undefined,
    onBookRestored: () => undefined,
    onBookMoved: () => undefined,
    onBookTransferred: () => undefined,
  }),
}))

vi.mock('@/features/scanner/composables/useScanProgress', () => ({
  useScanProgress: () => ({ subscribeLibrary: vi.fn<() => void>() }),
}))

vi.mock('@/composables/usePageTitle', () => ({
  usePageTitle: () => undefined,
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}))

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({ libraries: ref([]) }),
}))

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
    publishedYear: null,
    language: null,
    pageCount: null,
    seriesName: null,
    seriesIndex: null,
    rating: 2,
    communityRatings: [],
    coverSource: null,
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
  emits: ['saved'],
  setup(props, { emit }) {
    function emitSaved() {
      emit('saved', { ...props.book, rating: 4 })
    }
    return { emitSaved }
  },
  template: `
    <div>
      <div data-test="details-rating">{{ book.rating }}</div>
      <button data-test="details-save" @click="emitSaved">save</button>
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
    mockState.detail = ref(makeBook())
    mockState.loading = ref(false)
    mockState.notFound = ref(false)
    mockState.fetch.mockReset()
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
})
