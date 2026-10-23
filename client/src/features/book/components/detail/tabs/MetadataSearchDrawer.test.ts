import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { MetadataProviderKey, type BookDetail } from '@bookorbit/types'
import MetadataSearchDrawer from './MetadataSearchDrawer.vue'

type SearchCall = { title?: string; author?: string; isbn?: string; bookId?: number; isAudiobook?: boolean; mediaKind?: string; providers?: string[] }

const metadataSearchMocks = vi.hoisted(() => ({
  instances: 0,
  loadProviders: vi.fn<(bookId?: number) => Promise<void>>(async () => {}),
  search: vi.fn<(params: SearchCall) => void>(),
  secondSearch: vi.fn<(params: SearchCall) => void>(),
  toggleProvider: vi.fn<(provider: string) => void>(),
  retryProvider: vi.fn<(provider: string) => Promise<void>>(async () => {}),
  selectFieldRuleProviders: vi.fn<() => void>(),
  clearProviderFilter: vi.fn<() => void>(),
}))

vi.mock('../../../composables/useCoverVersions', () => ({
  useCoverVersions: () => ({
    coverUrl: (bookId: number, _type: string, _version: string, medium?: string) => `/covers/${bookId}${medium ? `?medium=${medium}` : ''}`,
  }),
}))

vi.mock('../../../composables/useMetadataSearchPreferences', async () => {
  const { ref } = await vi.importActual<typeof import('vue')>('vue')
  return { useMetadataSearchPreferences: () => ({ autoSearchOnOpen: ref(true) }) }
})

vi.mock('../../../composables/useMetadataSearch', async () => {
  const vue = await vi.importActual<typeof import('vue')>('vue')

  return {
    // The drawer makes two searches: the book's own, then one as its other medium.
    useMetadataSearch: () => {
      const first = metadataSearchMocks.instances++ % 2 === 0
      return {
        results: vue.ref([]),
        filteredResults: vue.ref([]),
        providerCounts: vue.reactive({}),
        interruptedProviders: vue.ref([]),
        retryingProviders: vue.ref([]),
        resultProviderOrder: vue.ref(['google']),
        isStreaming: vue.ref(false),
        hasSearched: vue.ref(true),
        providers: vue.ref([{ key: 'google', label: 'Google Books', identifiable: true }]),
        selectedProviders: vue.ref([]),
        coverProviderOrder: vue.ref(['amazon', 'itunes']),
        audioCoverProviderOrder: vue.ref(['audible', 'itunes']),
        loadProviders: metadataSearchMocks.loadProviders,
        search: first ? metadataSearchMocks.search : metadataSearchMocks.secondSearch,
        retryProvider: metadataSearchMocks.retryProvider,
        toggleProvider: metadataSearchMocks.toggleProvider,
        selectFieldRuleProviders: metadataSearchMocks.selectFieldRuleProviders,
        clearProviderFilter: metadataSearchMocks.clearProviderFilter,
      }
    },
  }
})

const WorkspaceStub = defineComponent({
  name: 'MetadataMatchWorkspace',
  props: ['coverMedium', 'currentCoverUrl', 'secondCover', 'searchDefaults', 'coverPriority'],
  emits: ['search', 'toggleProvider', 'selectAll', 'selectFieldRules', 'retryProvider', 'apply', 'cancel'],
  setup(_, { emit }) {
    return () =>
      h('div', { 'data-testid': 'metadata-match-workspace' }, [
        h('button', { 'data-testid': 'search', onClick: () => emit('search', { title: 'Dune', author: 'Frank Herbert', isbn: '' }) }, 'Search'),
        h('button', { 'data-testid': 'toggle-google', onClick: () => emit('toggleProvider', MetadataProviderKey.GOOGLE) }, 'Google Books'),
        h('button', { 'data-testid': 'select-all', onClick: () => emit('selectAll') }, 'All'),
        h('button', { 'data-testid': 'retry-google', onClick: () => emit('retryProvider', MetadataProviderKey.GOOGLE) }, 'Retry'),
        h('button', { 'data-testid': 'apply', onClick: () => emit('apply', { formPatch: { title: 'Dune' } }) }, 'Apply'),
        h('button', { 'data-testid': 'cancel', onClick: () => emit('cancel') }, 'Cancel'),
      ])
  },
})

function makeBook(files: BookDetail['files'] = [], overrides: Partial<BookDetail> = {}): BookDetail {
  const coverMedia = [
    ...(files.some((file) => file.format !== 'm4b') ? (['ebook'] as const) : []),
    ...(files.some((file) => file.format === 'm4b') ? (['audio'] as const) : []),
  ]
  return {
    id: 42,
    title: 'Dune',
    authors: [{ id: 1, name: 'Frank Herbert' }],
    files,
    coverMedia,
    covers: { ebook: null, audio: null },
    coverSource: null,
    coverVersion: 'v1',
    ...overrides,
    genres: [],
    communityRatings: [],
    providerIds: {},
    addedAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  } as unknown as BookDetail
}

function makeFile(format: string, role: string): BookDetail['files'][number] {
  return { id: 1, format, role } as unknown as BookDetail['files'][number]
}

function mountDrawer(files: BookDetail['files'] = [], overrides: Partial<BookDetail> = {}) {
  return mount(MetadataSearchDrawer, {
    props: {
      book: makeBook(files, overrides),
      lockedFields: [],
    },
    global: {
      stubs: {
        // The sheet portals its content to <body>; render it in place so the panel can be found.
        DialogPortal: { template: '<div><slot /></div>' },
        MetadataMatchWorkspace: WorkspaceStub,
      },
    },
  })
}

describe('MetadataSearchDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    metadataSearchMocks.instances = 0
  })

  it('is a labelled dialog whose labelled close button closes it', async () => {
    const wrapper = mountDrawer()
    expect(wrapper.get('[role="dialog"]').attributes('aria-labelledby')).toBeTruthy()

    await wrapper.get('button[aria-label="Close"]').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it("runs the search with the book's details as soon as the providers are loaded", async () => {
    mountDrawer([], { isbn13: '9780441013593' } as Partial<BookDetail>)
    await flushPromises()

    expect(metadataSearchMocks.loadProviders).toHaveBeenCalledWith(42)
    expect(metadataSearchMocks.search).toHaveBeenCalledWith({
      title: 'Dune',
      author: 'Frank Herbert',
      isbn: '9780441013593',
      bookId: 42,
      isAudiobook: false,
    })
  })

  it('waits for a query when the book has neither a title nor an ISBN', async () => {
    mountDrawer([], { title: null } as unknown as Partial<BookDetail>)
    await flushPromises()

    expect(metadataSearchMocks.search).not.toHaveBeenCalled()
  })

  it('uses ISBN-10 when ISBN-13 is empty', async () => {
    mountDrawer([], { isbn13: ' ', isbn10: '0306406152' } as Partial<BookDetail>)
    await flushPromises()
    expect(metadataSearchMocks.search).toHaveBeenCalledWith(expect.objectContaining({ isbn: '0306406152' }))
  })

  it('filters sources and retries one without re-running the whole search', async () => {
    const wrapper = mountDrawer()
    await flushPromises()
    metadataSearchMocks.search.mockClear()

    await wrapper.find('[data-testid="search"]').trigger('click')
    expect(metadataSearchMocks.search).toHaveBeenCalledTimes(1)
    expect(metadataSearchMocks.search).toHaveBeenLastCalledWith({ title: 'Dune', author: 'Frank Herbert', isbn: '', bookId: 42, isAudiobook: false })

    await wrapper.find('[data-testid="toggle-google"]').trigger('click')
    await wrapper.find('[data-testid="select-all"]').trigger('click')
    await wrapper.find('[data-testid="retry-google"]').trigger('click')

    expect(metadataSearchMocks.toggleProvider).toHaveBeenCalledWith(MetadataProviderKey.GOOGLE)
    expect(metadataSearchMocks.clearProviderFilter).toHaveBeenCalledTimes(1)
    expect(metadataSearchMocks.retryProvider).toHaveBeenCalledWith(MetadataProviderKey.GOOGLE)
    expect(metadataSearchMocks.search).toHaveBeenCalledTimes(1)
  })

  it('hands the applied changes up and closes, and closes on cancel', async () => {
    const wrapper = mountDrawer()

    await wrapper.find('[data-testid="apply"]').trigger('click')
    expect(wrapper.emitted('apply')).toEqual([[{ formPatch: { title: 'Dune' } }]])
    expect(wrapper.emitted('close')).toHaveLength(1)

    await wrapper.find('[data-testid="cancel"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(2)
  })

  it('searches ebook metadata for a book whose primary file is an ebook', async () => {
    const wrapper = mountDrawer([makeFile('epub', 'primary'), makeFile('m4b', 'content')])

    await wrapper.find('[data-testid="search"]').trigger('click')

    expect(metadataSearchMocks.search).toHaveBeenLastCalledWith(expect.objectContaining({ isAudiobook: false }))
    expect(wrapper.getComponent(WorkspaceStub).props('coverMedium')).toBe('ebook')
  })

  it('searches audiobook metadata for a book whose primary file is audio', async () => {
    const wrapper = mountDrawer([makeFile('m4b', 'primary'), makeFile('epub', 'content')])

    await wrapper.find('[data-testid="search"]').trigger('click')

    expect(metadataSearchMocks.search).toHaveBeenLastCalledWith(expect.objectContaining({ isAudiobook: true }))
    expect(wrapper.getComponent(WorkspaceStub).props('coverMedium')).toBe('audio')
    expect(wrapper.getComponent(WorkspaceStub).props('coverPriority')).toEqual(['audible', 'itunes'])
  })

  it('searches the other medium too for a book with both, without the ISBN and with its cover rule providers', async () => {
    const wrapper = mountDrawer([makeFile('epub', 'primary'), makeFile('m4b', 'content')])

    await wrapper.find('[data-testid="search"]').trigger('click')

    expect(metadataSearchMocks.secondSearch).toHaveBeenCalledWith({
      title: 'Dune',
      author: 'Frank Herbert',
      bookId: 42,
      mediaKind: 'audiobook',
      providers: ['audible', 'itunes'],
    })
    expect(wrapper.getComponent(WorkspaceStub).props('secondCover')).toMatchObject({ medium: 'audio', priority: ['audible', 'itunes'] })
  })

  it('searches the book edition as the other medium for an audiobook-first book', async () => {
    const wrapper = mountDrawer([makeFile('m4b', 'primary'), makeFile('epub', 'content')])

    await wrapper.find('[data-testid="search"]').trigger('click')

    expect(metadataSearchMocks.secondSearch).toHaveBeenCalledWith(expect.objectContaining({ mediaKind: 'ebook', providers: ['amazon', 'itunes'] }))
  })

  it('makes no second search for a book with one medium', async () => {
    const wrapper = mountDrawer([makeFile('epub', 'primary')])

    await wrapper.find('[data-testid="search"]').trigger('click')

    expect(metadataSearchMocks.secondSearch).not.toHaveBeenCalled()
    expect(wrapper.getComponent(WorkspaceStub).props('secondCover')).toBeNull()
  })
})
