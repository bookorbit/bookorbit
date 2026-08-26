import { shallowMount } from '@vue/test-utils'
import { defineComponent, reactive, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookDockFile, MetadataCandidate } from '@bookorbit/types'
import BookDockFileSheet from '../BookDockFileSheet.vue'

const mocks = vi.hoisted(() => ({
  fetchLibraries: vi.fn<() => Promise<void>>(),
  loadProviders: vi.fn<() => Promise<void>>(),
  search: vi.fn<(...args: unknown[]) => Promise<void>>(),
  saveMetadata: vi.fn<(...args: unknown[]) => Promise<null>>(),
  filteredResults: [] as MetadataCandidate[],
}))

vi.mock('../../composables/useBookDockDetail', () => ({
  useBookDockDetail: () => ({
    saved: ref(false),
    saveError: ref(null),
    saveMetadata: mocks.saveMetadata,
    setTarget: vi.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
    coverUrl: (id: number) => `/api/v1/book-dock/files/${id}/cover`,
  }),
}))

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({
    libraries: ref([]),
    fetchLibraries: mocks.fetchLibraries,
  }),
}))

vi.mock('@/features/book/composables/useMetadataSearch', () => ({
  useMetadataSearch: () => ({
    filteredResults: ref(mocks.filteredResults),
    providerCounts: reactive({}),
    isStreaming: ref(false),
    hasSearched: ref(false),
    providers: ref([]),
    selectedProviders: ref([]),
    loadProviders: mocks.loadProviders,
    search: mocks.search,
    toggleProvider: vi.fn<(...args: unknown[]) => void>(),
    selectFieldRuleProviders: vi.fn<() => void>(),
    clearProviderFilter: vi.fn<() => void>(),
  }),
}))

const MetadataSearchPanelStub = defineComponent({
  name: 'MetadataSearchPanel',
  props: {
    searchDefaults: {
      type: Object,
      required: true,
    },
  },
  template: '<div data-test="metadata-search-panel" />',
})

const MetadataDiffPanelStub = defineComponent({
  name: 'MetadataDiffPanel',
  emits: ['apply'],
  template: '<div data-test="metadata-diff-panel" />',
})

function makeFile(overrides: Partial<BookDockFile> = {}): BookDockFile {
  return {
    id: 1,
    fileName: 'Batman #007.cbz',
    fileSize: 1024,
    format: 'cbz',
    status: 'ready',
    embeddedMetadata: {},
    selectedMetadata: null,
    fetchedMetadata: null,
    targetLibraryId: null,
    targetFolderId: null,
    confidence: null,
    fetchedMetadataSources: null,
    errorMessage: null,
    metadataEditedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    unitFiles: [],
    ...overrides,
  }
}

function mountSheet(file: BookDockFile) {
  return shallowMount(BookDockFileSheet, {
    props: { file },
    global: {
      stubs: {
        MetadataSearchPanel: MetadataSearchPanelStub,
        MetadataDiffPanel: MetadataDiffPanelStub,
        BookDockStatusBadge: true,
      },
    },
  })
}

async function openSearchAndReadDefaults(file: BookDockFile): Promise<Record<string, string | undefined>> {
  const wrapper = mountSheet(file)
  const searchButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Search')
  expect(searchButton).toBeDefined()
  await searchButton!.trigger('click')
  return wrapper.getComponent(MetadataSearchPanelStub).props('searchDefaults') as Record<string, string | undefined>
}

describe('BookDockFileSheet metadata search defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchLibraries.mockResolvedValue(undefined)
    mocks.loadProviders.mockResolvedValue(undefined)
    mocks.saveMetadata.mockResolvedValue(null)
    mocks.filteredResults.length = 0
  })

  it.each([
    {
      fileName: 'Batman #007.cbz',
      embeddedMetadata: {},
      expectedTitle: 'Batman #007',
    },
    {
      fileName: 'Saga.Volume.1.cbz',
      embeddedMetadata: { title: '   ' },
      expectedTitle: 'Saga.Volume.1',
    },
    {
      fileName: 'fallback.cbz',
      embeddedMetadata: { title: '  Canonical Title  ' },
      expectedTitle: 'Canonical Title',
    },
  ])('uses "$expectedTitle" for $fileName', async ({ fileName, embeddedMetadata, expectedTitle }) => {
    const defaults = await openSearchAndReadDefaults(makeFile({ fileName, embeddedMetadata }))

    expect(defaults).toEqual({
      title: expectedTitle,
      author: undefined,
      isbn: undefined,
    })
  })

  it('prefers user-selected metadata and keeps the other extracted search defaults', async () => {
    const defaults = await openSearchAndReadDefaults(
      makeFile({
        fileName: 'fallback.cbz',
        embeddedMetadata: { title: 'Embedded Title' },
        selectedMetadata: {
          title: '  User Edited Title  ',
          authors: ['Primary Author', 'Second Author'],
          isbn13: '9781401284770',
        },
      }),
    )

    expect(defaults).toEqual({
      title: 'User Edited Title',
      author: 'Primary Author',
      isbn: '9781401284770',
    })
  })

  it('autosaves an exact series index label including its trailing zero', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = mountSheet(makeFile({ embeddedMetadata: { seriesName: 'Dune' } }))
      const label = wrapper.findAll('label').find((item) => item.text().includes('Series #'))
      expect(label).toBeDefined()
      const input = label!.get<HTMLInputElement>('input')

      for (const character of '5.10') {
        input.element.value += character
        await input.trigger('input')
      }
      await vi.advanceTimersByTimeAsync(1000)

      expect(input.element.value).toBe('5.10')
      expect(mocks.saveMetadata).toHaveBeenLastCalledWith(1, expect.objectContaining({ seriesIndex: '5.10' }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows an error and does not autosave a malformed series index', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = mountSheet(makeFile())
      const label = wrapper.findAll('label').find((item) => item.text().includes('Series #'))
      const input = label!.get<HTMLInputElement>('input')

      await input.setValue('1.2.3')
      await vi.advanceTimersByTimeAsync(1000)

      expect(label!.get('[role="alert"]').text()).toContain('at most one decimal point')
      expect(mocks.saveMetadata).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('persists every metadata field emitted by the search diff', async () => {
    const candidate: MetadataCandidate = {
      provider: 'hardcover',
      providerId: 'hardcover-book',
      title: 'Dune',
    }
    mocks.filteredResults.push(candidate)
    const wrapper = mountSheet(makeFile())
    const searchButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Search')
    await searchButton!.trigger('click')
    wrapper.getComponent(MetadataSearchPanelStub).vm.$emit('select', candidate)
    await wrapper.vm.$nextTick()

    wrapper.getComponent(MetadataDiffPanelStub).vm.$emit('apply', {
      formPatch: {
        title: 'Dune',
        pageCount: 688,
        narrators: ['Simon Vance'],
        durationSeconds: 1200,
        abridged: false,
        seriesMemberships: [{ seriesName: 'Dune', seriesIndex: '1' }],
        communityRatings: [{ provider: 'hardcover', rating: 4.5, ratingCount: 1000 }],
        hardcoverId: 'hardcover-book',
        hardcoverEditionId: 'hardcover-edition',
        openLibraryId: 'OL1W',
        comicMetadata: { issueNumber: '1', pencillers: ['Artist'] },
      },
      coverUrl: 'https://covers.example/dune.jpg',
    })
    await wrapper.vm.$nextTick()

    expect(mocks.saveMetadata).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        title: 'Dune',
        pageCount: 688,
        narrators: ['Simon Vance'],
        durationSeconds: 1200,
        abridged: false,
        seriesMemberships: [{ seriesName: 'Dune', seriesIndex: '1' }],
        communityRatings: [{ provider: 'hardcover', rating: 4.5, ratingCount: 1000 }],
        hardcoverId: 'hardcover-book',
        hardcoverEditionId: 'hardcover-edition',
        openLibraryId: 'OL1W',
        comicMetadata: { issueNumber: '1', pencillers: ['Artist'] },
        coverUrl: 'https://covers.example/dune.jpg',
      }),
    )
  })

  it('requests confirmation before discarding the file', async () => {
    const dockFile = makeFile()
    const wrapper = mountSheet(dockFile)
    const discardButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Discard')

    expect(discardButton).toBeDefined()
    await discardButton!.trigger('click')

    expect(wrapper.emitted('discard')).toEqual([[dockFile]])
    expect(wrapper.emitted('close')).toBeUndefined()
  })
})
