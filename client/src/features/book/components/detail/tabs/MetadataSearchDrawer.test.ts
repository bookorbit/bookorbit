import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { MetadataProviderKey, type BookDetail } from '@bookorbit/types'
import MetadataSearchDrawer from './MetadataSearchDrawer.vue'

const metadataSearchMocks = vi.hoisted(() => ({
  loadProviders: vi.fn<(bookId?: number) => void>(),
  search: vi.fn<(params: { title?: string; author?: string; isbn?: string; bookId?: number; isAudiobook?: boolean }) => void>(),
  toggleProvider: vi.fn<(provider: string) => void>(),
  selectFieldRuleProviders: vi.fn<() => void>(),
  clearProviderFilter: vi.fn<() => void>(),
}))

vi.mock('../../../composables/useCoverVersions', () => ({
  useCoverVersions: () => ({
    coverUrl: () => '/covers/42',
  }),
}))

vi.mock('../../../composables/useMetadataSearch', async () => {
  const vue = await vi.importActual<typeof import('vue')>('vue')

  return {
    useMetadataSearch: () => ({
      filteredResults: vue.ref([]),
      providerCounts: vue.reactive({}),
      isStreaming: vue.ref(false),
      hasSearched: vue.ref(true),
      providers: vue.ref([{ key: 'google', label: 'Google Books', identifiable: true }]),
      selectedProviders: vue.ref([]),
      loadProviders: metadataSearchMocks.loadProviders,
      search: metadataSearchMocks.search,
      toggleProvider: metadataSearchMocks.toggleProvider,
      selectFieldRuleProviders: metadataSearchMocks.selectFieldRuleProviders,
      clearProviderFilter: metadataSearchMocks.clearProviderFilter,
    }),
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

function makeBook(): BookDetail {
  return {
    id: 42,
    title: 'Dune',
    authors: [{ id: 1, name: 'Frank Herbert' }],
    files: [],
    genres: [],
    communityRatings: [],
    providerIds: {},
    addedAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  } as unknown as BookDetail
}

function mountDrawer() {
  return mount(MetadataSearchDrawer, {
    props: {
      book: makeBook(),
      lockedFields: [],
    },
    global: {
      stubs: {
        Teleport: true,
        MetadataSearchPanel: MetadataSearchPanelStub,
        MetadataDiffPanel: true,
      },
    },
  })
}

describe('MetadataSearchDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
