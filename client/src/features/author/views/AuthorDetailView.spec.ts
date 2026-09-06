import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, ref, type Ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { AuthorDetail, BookCard } from '@bookorbit/types'
import AuthorDetailView from './AuthorDetailView.vue'
import { deleteAuthorImage, refreshAuthorMetadata, updateAuthor, uploadAuthorImage } from '../api/author'
import { i18n } from '@/i18n'

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
  bookTotal: null as unknown as Ref<number>,
  loadingBooks: null as unknown as Ref<boolean>,
  booksError: null as unknown as Ref<string | null>,
  hasMore: null as unknown as Ref<boolean>,
  sort: null as unknown as Ref<'addedAt' | 'title' | 'publishedYear'>,
  order: null as unknown as Ref<'asc' | 'desc'>,
  libraryId: null as unknown as Ref<number | null>,
  collapseSeries: null as unknown as Ref<boolean>,
  collapsePreference: false,
  setCollapsePreference: vi.fn<(ctx: unknown, value: boolean | null) => Promise<void>>(),
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
    bookTotal: mocks.bookTotal,
    loading: mocks.loadingBooks,
    error: mocks.booksError,
    hasMore: mocks.hasMore,
    sort: mocks.sort,
    order: mocks.order,
    libraryId: mocks.libraryId,
    collapseSeries: mocks.collapseSeries,
    load: mocks.loadBooks,
  }),
}))

vi.mock('@/features/book/composables/useSeriesCollapsePreference', () => ({
  useSeriesCollapsePreference: () => ({
    getEffectivePreference: () => mocks.collapsePreference,
    setPreference: mocks.setCollapsePreference,
    prefs: ref(undefined),
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
          emits: ['edit', 'merge', 'refresh', 'delete'],
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
    mocks.bookTotal = ref(2)
    mocks.loadingBooks = ref(false)
    mocks.booksError = ref(null)
    mocks.hasMore = ref(false)
    mocks.sort = ref('addedAt')
    mocks.order = ref('desc')
    mocks.libraryId = ref(null)
    mocks.collapseSeries = ref(false)
    mocks.collapsePreference = false
    mocks.setCollapsePreference.mockResolvedValue()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  async function openEditPanel() {
    const wrapper = await mountView()
    await wrapper.getComponent({ name: 'AuthorHeader' }).vm.$emit('edit')
    await flushPromises()
    return wrapper
  }

  function editFields(wrapper: Awaited<ReturnType<typeof mountView>>) {
    const textInputs = wrapper.findAll('input:not([type="file"])')
    expect(textInputs).toHaveLength(2)
    return {
      name: textInputs[0],
      sortName: textInputs[1],
      description: wrapper.get('textarea'),
    }
  }

  function findButtonByLabel(wrapper: Awaited<ReturnType<typeof mountView>>, key: string) {
    const label = i18n.global.t(key)
    const button = wrapper.findAll('button').find((candidate) => candidate.text().includes(label))
    expect(button, `no button labelled "${label}"`).toBeDefined()
    return button!
  }

  async function selectImageFile(wrapper: Awaited<ReturnType<typeof mountView>>) {
    const input = wrapper.get('input[type="file"]')
    Object.defineProperty(input.element, 'files', {
      value: [new File(['image-bytes'], 'portrait.png', { type: 'image/png' })],
      configurable: true,
    })
    await input.trigger('change')
    await flushPromises()
  }

  describe('series collapse toggle', () => {
    it('starts from the saved author pages preference', async () => {
      mocks.collapsePreference = true

      const wrapper = await mountView()

      expect(mocks.collapseSeries.value).toBe(true)
      expect(wrapper.get('[data-testid="author-collapse-series-toggle"]').attributes('aria-pressed')).toBe('true')
    })

    it('turns collapsing on and remembers it for every author page', async () => {
      const wrapper = await mountView()

      await wrapper.get('[data-testid="author-collapse-series-toggle"]').trigger('click')
      await flushPromises()

      expect(mocks.collapseSeries.value).toBe(true)
      expect(mocks.setCollapsePreference).toHaveBeenCalledWith({ authorPages: true }, true)
    })

    it('turns collapsing back off', async () => {
      mocks.collapsePreference = true

      const wrapper = await mountView()
      await wrapper.get('[data-testid="author-collapse-series-toggle"]').trigger('click')
      await flushPromises()

      expect(mocks.collapseSeries.value).toBe(false)
      expect(mocks.setCollapsePreference).toHaveBeenCalledWith({ authorPages: true }, false)
    })

    it('counts books rather than rows in the all-loaded label', async () => {
      // 2 collapsed rows standing for 200 books: the reader should be told about the books.
      mocks.total = ref(2)
      mocks.bookTotal = ref(200)
      mocks.hasMore = ref(false)

      const wrapper = await mountView()

      expect(wrapper.text()).toContain(i18n.global.t('author.detail.books.allLoaded', { total: '200' }))
    })
  })

  it('keeps unsaved edit fields when an author image is uploaded', async () => {
    vi.mocked(uploadAuthorImage).mockResolvedValue(makeAuthor({ imageUrl: '/api/v1/authors/7/image' }))

    const wrapper = await openEditPanel()
    const fields = editFields(wrapper)
    await fields.name.setValue('Ursula K. Le Guin')
    await fields.sortName.setValue('Le Guin, Ursula K.')
    await fields.description.setValue('A biography typed but not saved yet.')

    await selectImageFile(wrapper)

    expect(vi.mocked(uploadAuthorImage)).toHaveBeenCalledTimes(1)
    const after = editFields(wrapper)
    expect((after.name.element as HTMLInputElement).value).toBe('Ursula K. Le Guin')
    expect((after.sortName.element as HTMLInputElement).value).toBe('Le Guin, Ursula K.')
    expect((after.description.element as HTMLTextAreaElement).value).toBe('A biography typed but not saved yet.')
  })

  it('keeps unsaved edit fields when the author image is removed', async () => {
    mocks.author = ref(makeAuthor({ imageUrl: '/api/v1/authors/7/image' }))
    vi.mocked(deleteAuthorImage).mockResolvedValue(makeAuthor({ imageUrl: null }))

    const wrapper = await openEditPanel()
    await editFields(wrapper).description.setValue('Still typing this.')

    await findButtonByLabel(wrapper, 'author.detail.edit.removeImage').trigger('click')
    await flushPromises()

    expect(vi.mocked(deleteAuthorImage)).toHaveBeenCalledTimes(1)
    expect((editFields(wrapper).description.element as HTMLTextAreaElement).value).toBe('Still typing this.')
  })

  it('keeps unsaved edit fields when author metadata is refreshed', async () => {
    vi.mocked(refreshAuthorMetadata).mockResolvedValue(makeAuthor({ description: 'Provider biography', imageUrl: '/api/v1/authors/7/image' }))

    const wrapper = await openEditPanel()
    await editFields(wrapper).description.setValue('Hand written biography.')

    await wrapper.getComponent({ name: 'AuthorHeader' }).vm.$emit('refresh')
    await flushPromises()

    expect(vi.mocked(refreshAuthorMetadata)).toHaveBeenCalledTimes(1)
    expect((editFields(wrapper).description.element as HTMLTextAreaElement).value).toBe('Hand written biography.')
  })

  it('adopts server values into an untouched edit form', async () => {
    vi.mocked(uploadAuthorImage).mockResolvedValue(makeAuthor({ description: 'Server biography', imageUrl: '/api/v1/authors/7/image' }))

    const wrapper = await openEditPanel()
    expect((editFields(wrapper).description.element as HTMLTextAreaElement).value).toBe('')

    await selectImageFile(wrapper)

    expect((editFields(wrapper).description.element as HTMLTextAreaElement).value).toBe('Server biography')
  })

  it('reseeds the edit form when a different author is loaded, even with unsaved edits', async () => {
    const wrapper = await openEditPanel()
    await editFields(wrapper).description.setValue('Unsaved text for author 7.')

    mocks.author.value = makeAuthor({ id: 8, name: 'Другой автор', description: 'Author 8 biography' })
    await flushPromises()

    const after = editFields(wrapper)
    expect((after.name.element as HTMLInputElement).value).toBe('Другой автор')
    expect((after.description.element as HTMLTextAreaElement).value).toBe('Author 8 biography')
  })

  it('stops treating the form as unsaved once the edits are saved', async () => {
    vi.mocked(updateAuthor).mockImplementation(async (_id, payload) => makeAuthor({ ...payload }))
    vi.mocked(refreshAuthorMetadata).mockResolvedValue(makeAuthor({ description: 'Provider biography' }))

    const wrapper = await openEditPanel()
    await editFields(wrapper).description.setValue('  Saved biography  ')

    await findButtonByLabel(wrapper, 'common.save').trigger('click')
    await flushPromises()

    expect(vi.mocked(updateAuthor)).toHaveBeenCalledWith(7, { name: 'Author', sortName: null, description: 'Saved biography' })

    await wrapper.getComponent({ name: 'AuthorHeader' }).vm.$emit('refresh')
    await flushPromises()
    await wrapper.getComponent({ name: 'AuthorHeader' }).vm.$emit('edit')
    await flushPromises()

    expect((editFields(wrapper).description.element as HTMLTextAreaElement).value).toBe('Provider biography')
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
