import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, ref, type Ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { AuthorDetail, BookCard } from '@bookorbit/types'
import AuthorDetailView from './AuthorDetailView.vue'

class MockIntersectionObserver {
  observe = vi.fn<(target: Element) => void>()
  unobserve = vi.fn<(target: Element) => void>()
  disconnect = vi.fn<() => void>()
  takeRecords = vi.fn<() => IntersectionObserverEntry[]>(() => [])
}

const mocks = vi.hoisted(() => ({
  route: { params: { id: '7' }, query: {} as Record<string, unknown> },
  routerPush: vi.fn<(to: unknown) => Promise<void>>(),
  routerBack: vi.fn<() => void>(),
  fetchLibraries: vi.fn<() => Promise<void>>(),
  loadAuthor: vi.fn<() => Promise<void>>(),
  loadBooks: vi.fn<(reset?: boolean) => Promise<void>>(),
  loadMetadataPreview: vi.fn<() => Promise<void>>(),
  cancelMetadataPreview: vi.fn<() => void>(),
  api: vi.fn<(url: string, init?: RequestInit) => Promise<{ ok: boolean }>>(),
  author: null as unknown as Ref<AuthorDetail | null>,
  loadingAuthor: null as unknown as Ref<boolean>,
  authorError: null as unknown as Ref<string | null>,
  authorNotFound: null as unknown as Ref<boolean>,
  books: null as unknown as Ref<BookCard[]>,
  total: null as unknown as Ref<number>,
  loadingBooks: null as unknown as Ref<boolean>,
  booksError: null as unknown as Ref<string | null>,
  hasMore: null as unknown as Ref<boolean>,
  sort: null as unknown as Ref<'addedAt' | 'title' | 'publishedYear'>,
  order: null as unknown as Ref<'asc' | 'desc'>,
  libraryId: null as unknown as Ref<number | null>,
}))

vi.mock('vue-router', () => ({
  useRoute: () => mocks.route,
  useRouter: () => ({ push: mocks.routerPush, back: mocks.routerBack }),
}))

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn<(message: string) => void>(), error: vi.fn<(message: string) => void>(), warning: vi.fn<(message: string) => void>() },
}))

vi.mock('@vueuse/core', () => ({
  useWindowSize: () => ({ width: ref(1024) }),
}))

vi.mock('@/lib/api', () => ({
  api: mocks.api,
}))

vi.mock('@/features/book/composables/useScrollRestoreOnActivate', () => ({
  useScrollRestoreOnActivate: () => undefined,
}))

vi.mock('@/composables/useDisplaySettings', () => ({
  useDisplaySettings: () => ({
    portraitCoverSize: ref(140),
    gridGap: ref(16),
  }),
}))

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({ libraries: ref([]), fetchLibraries: mocks.fetchLibraries }),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true, isSuperuser: ref(false) }),
}))

vi.mock('@/composables/usePageTitle', () => ({
  usePageTitle: () => undefined,
}))

vi.mock('../api/author', () => ({
  MAX_AUTHOR_IMAGE_BYTES: 5 * 1024 * 1024,
  deleteAuthorImage: vi.fn<(authorId: number) => Promise<AuthorDetail>>(),
  deleteAuthors: vi.fn<(payload: { authorIds: number[] }) => Promise<{ affectedBookCount: number }>>(),
  fetchAuthors: vi.fn<() => Promise<unknown>>(),
  mergeAuthors: vi.fn<() => Promise<unknown>>(),
  refreshAuthorMetadata: vi.fn<(authorId: number) => Promise<AuthorDetail>>(),
  updateAuthor: vi.fn<() => Promise<AuthorDetail>>(),
  uploadAuthorImage: vi.fn<(authorId: number, file: File) => Promise<AuthorDetail>>(),
}))

vi.mock('../composables/useAuthorDetail', () => ({
  useAuthorDetail: () => ({
    author: mocks.author,
    loading: mocks.loadingAuthor,
    error: mocks.authorError,
    notFound: mocks.authorNotFound,
    load: mocks.loadAuthor,
  }),
}))

vi.mock('../composables/useAuthorBooks', () => ({
  useAuthorBooks: () => ({
    items: mocks.books,
    total: mocks.total,
    loading: mocks.loadingBooks,
    error: mocks.booksError,
    hasMore: mocks.hasMore,
    sort: mocks.sort,
    order: mocks.order,
    libraryId: mocks.libraryId,
    load: mocks.loadBooks,
  }),
}))

vi.mock('../composables/useAuthorMetadataPreview', () => ({
  useAuthorMetadataPreview: () => ({
    preview: ref(null),
    loading: ref(false),
    error: ref(null),
    cancel: mocks.cancelMetadataPreview,
    load: mocks.loadMetadataPreview,
  }),
}))

const VirtualBookGridStub = defineComponent({
  name: 'VirtualBookGrid',
  props: {
    books: {
      type: Array,
      required: true,
    },
  },
  emits: ['action', 'update:book'],
  template: '<div data-test="virtual-book-grid" />',
})

const DeleteBookDialogStub = defineComponent({
  name: 'DeleteBookDialog',
  props: {
    open: {
      type: Boolean,
      required: true,
    },
    deleting: {
      type: Boolean,
      required: true,
    },
  },
  emits: ['confirm', 'cancel'],
  template: '<div data-test="delete-book-dialog" :data-open="String(open)" />',
})

function makeAuthor(overrides: Partial<AuthorDetail> = {}): AuthorDetail {
  return {
    id: 7,
    name: 'Author',
    sortName: null,
    description: null,
    imageUrl: null,
    bookCount: 2,
    lastAddedAt: '2026-01-01T00:00:00.000Z',
    birthDate: null,
    birthYear: null,
    deathDate: null,
    deathYear: null,
    website: null,
    genres: [],
    influences: [],
    metadataProvider: null,
    metadataProviderId: null,
    ...overrides,
  }
}

function makeBook(id: number): BookCard {
  return {
    id,
    title: `Book ${id}`,
  } as BookCard
}

async function mountView() {
  const wrapper = mount(AuthorDetailView, {
    global: {
      stubs: {
        AuthorHeader: {
          name: 'AuthorHeader',
          props: ['author'],
          template: '<div data-test="author-header">{{ author.bookCount }}</div>',
        },
        AuthorConfirmDialog: {
          name: 'AuthorConfirmDialog',
          props: ['open'],
          emits: ['confirm', 'cancel'],
          template: '<div />',
        },
        BookListRow: {
          name: 'BookListRow',
          props: ['book'],
          emits: ['action'],
          template: '<div />',
        },
        DeleteBookDialog: DeleteBookDialogStub,
        EntityNotFound: true,
        VirtualBookGrid: VirtualBookGridStub,
      },
    },
  })
  await flushPromises()
  return wrapper
}

describe('AuthorDetailView', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
    mocks.route.params = { id: '7' }
    mocks.route.query = {}
    mocks.routerPush.mockResolvedValue()
    mocks.fetchLibraries.mockResolvedValue()
    mocks.loadAuthor.mockResolvedValue()
    mocks.loadBooks.mockResolvedValue()
    mocks.loadMetadataPreview.mockResolvedValue()
    mocks.api.mockResolvedValue({ ok: true })
    mocks.author = ref(makeAuthor())
    mocks.loadingAuthor = ref(false)
    mocks.authorError = ref(null)
    mocks.authorNotFound = ref(false)
    mocks.books = ref([makeBook(101), makeBook(102)])
    mocks.total = ref(2)
    mocks.loadingBooks = ref(false)
    mocks.booksError = ref(null)
    mocks.hasMore = ref(false)
    mocks.sort = ref('addedAt')
    mocks.order = ref('desc')
    mocks.libraryId = ref(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('deletes a book from the author grid menu action', async () => {
    const wrapper = await mountView()

    const grid = wrapper.getComponent(VirtualBookGridStub)
    await grid.vm.$emit('action', mocks.books.value[0], 'delete')
    await wrapper.vm.$nextTick()

    let dialog = wrapper.getComponent(DeleteBookDialogStub)
    expect(dialog.props('open')).toBe(true)

    await dialog.vm.$emit('confirm')
    await flushPromises()

    expect(mocks.api).toHaveBeenCalledWith('/api/v1/books', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookIds: [101] }),
    })
    expect(mocks.books.value.map((book) => book.id)).toEqual([102])
    expect(mocks.total.value).toBe(1)
    expect(mocks.author.value?.bookCount).toBe(1)

    dialog = wrapper.getComponent(DeleteBookDialogStub)
    expect(dialog.props('open')).toBe(false)
  })
})
