import { flushPromises, shallowMount } from '@vue/test-utils'
import { defineComponent, reactive, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookDockFile, Library, MetadataCandidate } from '@bookorbit/types'
import { i18n } from '@/i18n'
import BookDockFileSheet from '../BookDockFileSheet.vue'

type LibraryOption = Pick<Library, 'id' | 'name' | 'type'> & {
  folders: Array<Pick<Library['folders'][number], 'id' | 'path'>>
}

const mocks = vi.hoisted(() => ({
  fetchLibraries: vi.fn<() => Promise<void>>(),
  loadProviders: vi.fn<() => Promise<void>>(),
  search: vi.fn<(...args: unknown[]) => Promise<void>>(),
  saveMetadata: vi.fn<(...args: unknown[]) => Promise<null>>(),
  setTarget: vi.fn<(...args: unknown[]) => Promise<BookDockFile | null>>(),
  filteredResults: [] as MetadataCandidate[],
  libraries: [] as LibraryOption[],
}))

const libraryOptions = ref<LibraryOption[]>([])

vi.mock('../../composables/useBookDockDetail', () => ({
  useBookDockDetail: () => ({
    saved: ref(false),
    saveError: ref(null),
    saveMetadata: mocks.saveMetadata,
    setTarget: mocks.setTarget,
    coverUrl: (id: number) => `/api/v1/book-dock/files/${id}/cover`,
  }),
}))

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({
    libraries: libraryOptions,
    fetchLibraries: mocks.fetchLibraries,
    loaded: ref(true),
    loading: ref(false),
    error: ref(null),
  }),
}))

vi.mock('@/features/book/composables/useMetadataSearch', () => ({
  useMetadataSearch: () => ({
    filteredResults: ref(mocks.filteredResults),
    providerCounts: reactive({}),
    interruptedProviders: ref([]),
    retryingProviders: ref([]),
    resultProviderOrder: ref([]),
    coverProviderOrder: ref(['amazon']),
    audioCoverProviderOrder: ref(['audible']),
    isStreaming: ref(false),
    hasSearched: ref(false),
    providers: ref([]),
    selectedProviders: ref([]),
    loadProviders: mocks.loadProviders,
    search: mocks.search,
    retryProvider: vi.fn<(...args: unknown[]) => Promise<void>>(),
    toggleProvider: vi.fn<(...args: unknown[]) => void>(),
    selectFieldRuleProviders: vi.fn<() => void>(),
    clearProviderFilter: vi.fn<() => void>(),
  }),
}))

const WorkspaceStub = defineComponent({
  name: 'MetadataMatchWorkspace',
  props: {
    searchDefaults: { type: Object, required: true },
    coverMedium: { type: String, default: undefined },
    coverPriority: { type: Array, default: undefined },
    fixedCandidate: { type: Object, default: null },
  },
  emits: ['search', 'apply', 'cancel'],
  template: '<div data-test="metadata-match-workspace" />',
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

const wrappers: ReturnType<typeof shallowMount>[] = []
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))

function mountSheet(file: BookDockFile) {
  const wrapper = shallowMount(BookDockFileSheet, {
    props: { file },
    global: {
      stubs: {
        MetadataMatchWorkspace: WorkspaceStub,
        BookDockStatusBadge: true,
        BookDestinationFields: false,
      },
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

async function openSearchAndReadDefaults(file: BookDockFile): Promise<Record<string, string | undefined>> {
  const wrapper = mountSheet(file)
  const searchButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Search')
  expect(searchButton).toBeDefined()
  await searchButton!.trigger('click')
  return wrapper.getComponent(WorkspaceStub).props('searchDefaults') as Record<string, string | undefined>
}

describe('BookDockFileSheet', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'en'
    vi.clearAllMocks()
    mocks.fetchLibraries.mockResolvedValue(undefined)
    mocks.loadProviders.mockResolvedValue(undefined)
    mocks.saveMetadata.mockResolvedValue(null)
    mocks.setTarget.mockResolvedValue(null)
    mocks.filteredResults.length = 0
    mocks.libraries.length = 0
    libraryOptions.value = mocks.libraries
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

    wrapper.getComponent(WorkspaceStub).vm.$emit('apply', {
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

  it('searches a docked file with its own name as soon as the search opens', async () => {
    const wrapper = mountSheet(makeFile({ fileName: 'Dune.epub', format: 'epub' }))
    const searchButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Search')
    await searchButton!.trigger('click')
    await flushPromises()

    expect(mocks.search).toHaveBeenCalledWith(expect.objectContaining({ title: 'Dune', mediaKind: 'ebook' }))
    expect(wrapper.getComponent(WorkspaceStub).props('fixedCandidate')).toBeNull()

    wrapper.getComponent(WorkspaceStub).vm.$emit('cancel')
    await wrapper.vm.$nextTick()
    expect(wrapper.findComponent(WorkspaceStub).exists()).toBe(false)
  })

  it('searches a docked audio file as an audiobook and stages the audiobook cover it picks', async () => {
    const candidate: MetadataCandidate = { provider: 'audible', providerId: 'B0DUNE', title: 'Dune' }
    mocks.filteredResults.push(candidate)
    const wrapper = mountSheet(makeFile({ fileName: 'Dune.m4b', format: 'm4b' }))
    const searchButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Search')
    await searchButton!.trigger('click')

    const workspace = wrapper.getComponent(WorkspaceStub)
    workspace.vm.$emit('search', { title: 'Dune', author: 'Frank Herbert', isbn: '' })
    expect(mocks.search).toHaveBeenLastCalledWith({ title: 'Dune', author: 'Frank Herbert', isbn: '', mediaKind: 'audiobook' })
    expect(workspace.props('coverMedium')).toBe('audio')
    expect(workspace.props('coverPriority')).toEqual(['audible'])

    workspace.vm.$emit('apply', { formPatch: {}, audioCoverUrl: 'https://covers.example/dune-audio.jpg' })
    await wrapper.vm.$nextTick()

    expect(mocks.saveMetadata).toHaveBeenCalledWith(1, expect.objectContaining({ coverUrl: 'https://covers.example/dune-audio.jpg' }))
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

  it('persists the visible default destination when finishing metadata edits', async () => {
    mocks.libraries.push({
      id: 7,
      type: 'books',
      name: 'Novels',
      folders: [{ id: 70, path: '/library/novels' }],
    })
    const updatedFile = makeFile({ targetLibraryId: 7, targetFolderId: 70 })
    mocks.setTarget.mockResolvedValue(updatedFile)
    const wrapper = mountSheet(makeFile())
    await flushPromises()
    expect(wrapper.findAll('select')).toHaveLength(0)
    expect(wrapper.text()).toContain('Novels')
    expect(wrapper.text()).toContain('/library/novels')

    const doneButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Done')
    await doneButton!.trigger('click')
    await flushPromises()

    expect(mocks.setTarget).toHaveBeenCalledWith(1, 7, 70)
    expect(wrapper.emitted('updated')).toEqual([[updatedFile]])
    expect(wrapper.emitted('close')).toEqual([[]])
  })

  it('does not save an unchanged destination again when finishing', async () => {
    mocks.libraries.push({
      id: 7,
      type: 'books',
      name: 'Novels',
      folders: [{ id: 70, path: '/library/novels' }],
    })
    const wrapper = mountSheet(makeFile({ targetLibraryId: 7, targetFolderId: 70 }))

    const doneButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Done')
    await doneButton!.trigger('click')
    await flushPromises()

    expect(mocks.setTarget).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toEqual([[]])
  })

  it('does not repeat a destination save that completed after changing the library', async () => {
    mocks.libraries.push(
      {
        id: 7,
        type: 'books',
        name: 'Novels',
        folders: [{ id: 70, path: '/library/novels' }],
      },
      {
        id: 8,
        type: 'books',
        name: 'Comics',
        folders: [{ id: 80, path: '/library/comics' }],
      },
    )
    const updatedFile = makeFile({ targetLibraryId: 8, targetFolderId: 80 })
    mocks.setTarget.mockResolvedValue(updatedFile)
    const wrapper = mountSheet(makeFile({ targetLibraryId: 7, targetFolderId: 70 }))
    const [librarySelect] = wrapper.findAll<HTMLSelectElement>('select')

    await librarySelect!.setValue('8')
    await flushPromises()

    expect(mocks.setTarget).toHaveBeenCalledTimes(1)
    expect(mocks.setTarget).toHaveBeenLastCalledWith(1, 8, 80)
    mocks.setTarget.mockClear()

    const doneButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Done')
    await doneButton!.trigger('click')
    await flushPromises()

    expect(mocks.setTarget).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toEqual([[]])
  })

  it('keeps the sheet open when the visible destination cannot be saved', async () => {
    mocks.libraries.push({
      id: 7,
      type: 'books',
      name: 'Novels',
      folders: [{ id: 70, path: '/library/novels' }],
    })
    mocks.setTarget.mockResolvedValue(null)
    const wrapper = mountSheet(makeFile())

    const doneButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Done')
    await doneButton!.trigger('click')
    await flushPromises()

    expect(mocks.setTarget).toHaveBeenCalledWith(1, 7, 70)
    expect(wrapper.emitted('updated')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
  })
  it('selects a delayed sole library and persists it only when Done is clicked', async () => {
    mocks.fetchLibraries.mockImplementation(async () => {
      libraryOptions.value = [{ id: 7, type: 'books', name: 'Novels', folders: [{ id: 70, path: '/books/novels' }] }]
    })
    mocks.setTarget.mockResolvedValue(makeFile({ targetLibraryId: 7, targetFolderId: 70 }))
    const wrapper = mountSheet(makeFile())
    await flushPromises()
    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.text()).toContain('Novels')
    expect(mocks.setTarget).not.toHaveBeenCalled()
    await wrapper
      .findAll('button')
      .find((button) => button.text().trim() === 'Done')!
      .trigger('click')
    await flushPromises()
    expect(mocks.setTarget).toHaveBeenCalledExactlyOnceWith(1, 7, 70)
  })

  it('preserves a saved non-first folder and offers the other folders', async () => {
    mocks.libraries.push({
      id: 7,
      type: 'books',
      name: 'Novels',
      folders: [
        { id: 70, path: '/books/first' },
        { id: 71, path: '/books/second' },
      ],
    })
    const wrapper = mountSheet(makeFile({ targetLibraryId: 7, targetFolderId: 71 }))
    await flushPromises()
    expect(wrapper.findAll('select')).toHaveLength(1)
    expect(wrapper.get<HTMLSelectElement>('select').element.value).toBe('71')
    await wrapper.get('select').setValue('70')
    await flushPromises()
    expect(mocks.setTarget).toHaveBeenCalledWith(1, 7, 70)
  })

  it('uses the next file destination when switching files in an open sheet', async () => {
    mocks.libraries.push(
      { id: 7, type: 'books', name: 'Novels', folders: [{ id: 70, path: '/books/novels' }] },
      { id: 8, type: 'books', name: 'Comics', folders: [{ id: 80, path: '/books/comics' }] },
    )
    const wrapper = mountSheet(makeFile({ targetLibraryId: 7, targetFolderId: 70 }))
    await wrapper.setProps({ file: makeFile({ id: 2, targetLibraryId: 8, targetFolderId: 80 }) })
    await flushPromises()
    expect(wrapper.get<HTMLSelectElement>('select').element.value).toBe('8')
    expect(wrapper.text()).toContain('/books/comics')
    await wrapper
      .findAll('button')
      .find((button) => button.text().trim() === 'Done')!
      .trigger('click')
    await flushPromises()
    expect(mocks.setTarget).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toEqual([[]])
  })

  it('does not overwrite an unavailable saved destination with the sole library', async () => {
    mocks.libraries.push({ id: 7, type: 'books', name: 'Novels', folders: [{ id: 70, path: '/books/novels' }] })
    const wrapper = mountSheet(makeFile({ targetLibraryId: 99, targetFolderId: 990 }))
    await flushPromises()
    expect(wrapper.get<HTMLSelectElement>('select').element.value).toBe('')
    await wrapper
      .findAll('button')
      .find((button) => button.text().trim() === 'Done')!
      .trigger('click')
    await flushPromises()
    expect(mocks.setTarget).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toEqual([[]])
  })
})
