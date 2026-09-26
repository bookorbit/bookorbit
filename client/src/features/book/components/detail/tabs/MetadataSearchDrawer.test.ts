import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { MetadataProviderKey, type BookDetail } from '@bookorbit/types'
import MetadataSearchDrawer from './MetadataSearchDrawer.vue'

type SearchCall = { title?: string; author?: string; isbn?: string; bookId?: number; isAudiobook?: boolean; mediaKind?: string; providers?: string[] }

const metadataSearchMocks = vi.hoisted(() => ({
  instances: 0,
  loadProviders: vi.fn<(bookId?: number) => void>(),
  search: vi.fn<(params: SearchCall) => void>(),
  secondSearch: vi.fn<(params: SearchCall) => void>(),
  toggleProvider: vi.fn<(provider: string) => void>(),
  selectFieldRuleProviders: vi.fn<() => void>(),
  clearProviderFilter: vi.fn<() => void>(),
}))

vi.mock('../../../composables/useCoverVersions', () => ({
  useCoverVersions: () => ({
    coverUrl: (bookId: number, _type: string, _version: string, medium?: string) => `/covers/${bookId}${medium ? `?medium=${medium}` : ''}`,
  }),
}))

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
        isStreaming: vue.ref(false),
        hasSearched: vue.ref(true),
        providers: vue.ref([{ key: 'google', label: 'Google Books', identifiable: true }]),
        selectedProviders: vue.ref([]),
        coverProviderOrder: vue.ref(['amazon', 'itunes']),
        audioCoverProviderOrder: vue.ref(['audible', 'itunes']),
        loadProviders: metadataSearchMocks.loadProviders,
        search: first ? metadataSearchMocks.search : metadataSearchMocks.secondSearch,
        toggleProvider: metadataSearchMocks.toggleProvider,
        selectFieldRuleProviders: metadataSearchMocks.selectFieldRuleProviders,
        clearProviderFilter: metadataSearchMocks.clearProviderFilter,
      }
    },
  }
})

const MetadataSearchPanelStub = defineComponent({
  name: 'MetadataSearchPanel',
  emits: ['search', 'toggleProvider', 'clearFilter', 'selectFieldRules'],
  setup(_, { emit }) {
    return () =>
      h('div', { 'data-testid': 'metadata-search-panel' }, [
        h(
          'button',
          {
            'data-testid': 'search',
            onClick: () => emit('search', { title: 'Dune', author: 'Frank Herbert', isbn: '' }),
          },
          'Search',
        ),
        h(
          'button',
          {
            'data-testid': 'toggle-google',
            onClick: () => emit('toggleProvider', MetadataProviderKey.GOOGLE),
          },
          'Google Books',
        ),
        h(
          'button',
          {
            'data-testid': 'clear-filter',
            onClick: () => emit('clearFilter'),
          },
          'All',
        ),
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
        MetadataSearchPanel: MetadataSearchPanelStub,
        MetadataDiffPanel: true,
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

  it('filters provider tabs without re-running the last metadata search', async () => {
    const wrapper = mountDrawer()

    await wrapper.find('[data-testid="search"]').trigger('click')
    expect(metadataSearchMocks.search).toHaveBeenCalledTimes(1)
    expect(metadataSearchMocks.search).toHaveBeenLastCalledWith({
      title: 'Dune',
      author: 'Frank Herbert',
      isbn: '',
      bookId: 42,
      isAudiobook: false,
    })

    await wrapper.find('[data-testid="toggle-google"]').trigger('click')
    await wrapper.find('[data-testid="clear-filter"]').trigger('click')

    expect(metadataSearchMocks.toggleProvider).toHaveBeenCalledWith(MetadataProviderKey.GOOGLE)
    expect(metadataSearchMocks.clearProviderFilter).toHaveBeenCalledTimes(1)
    expect(metadataSearchMocks.search).toHaveBeenCalledTimes(1)
  })

  it('searches ebook metadata for a book whose primary file is an ebook', async () => {
    const wrapper = mountDrawer([makeFile('epub', 'primary'), makeFile('m4b', 'content')])

    await wrapper.find('[data-testid="search"]').trigger('click')

    expect(metadataSearchMocks.search).toHaveBeenLastCalledWith(expect.objectContaining({ isAudiobook: false }))
  })

  it('searches audiobook metadata for a book whose primary file is audio', async () => {
    const wrapper = mountDrawer([makeFile('m4b', 'primary'), makeFile('epub', 'content')])

    await wrapper.find('[data-testid="search"]').trigger('click')

    expect(metadataSearchMocks.search).toHaveBeenLastCalledWith(expect.objectContaining({ isAudiobook: true }))
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
  })
})
