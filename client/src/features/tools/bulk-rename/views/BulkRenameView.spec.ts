import { flushPromises, shallowMount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Library } from '@bookorbit/types'

const libraries = ref<Library[]>([])
const fetchLibraries = vi.fn<() => Promise<void>>()
const selectLibrary = vi.fn<(libraryId: number) => void>()
const loadPreview = vi.fn<() => Promise<void>>()

const bulk = {
  selectedLibraryId: ref<number | null>(null),
  page: ref(1),
  pageSize: ref(50),
  statusFilter: ref(undefined),
  totalPages: ref(1),
  previewItems: ref([]),
  previewTotal: ref(0),
  totalByStatus: ref({ will_rename: 0, unchanged: 0, collision: 0, no_pattern: 0, error: 0 }),
  loading: ref(false),
  previewError: ref<string | null>(null),
  executing: ref(false),
  executionStats: ref(null),
  executionError: ref<string | null>(null),
  selectLibrary,
  loadPreview,
  execute: vi.fn<() => Promise<void>>(),
  cancelExecution: vi.fn<() => void>(),
  setPage: vi.fn<(page: number) => void>(),
  setStatusFilter: vi.fn<() => void>(),
}

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({ libraries, fetchLibraries }),
}))

vi.mock('../../composables/useBulkRename', () => ({
  useBulkRename: () => bulk,
}))

vi.mock('@vueuse/core', () => ({
  useElementSize: () => ({ width: ref(1024), height: ref(768) }),
}))

import BulkRenameView from './BulkRenameView.vue'

function makeLibrary(overrides: Partial<Library> = {}): Library {
  return {
    id: 1,
    name: 'Enabled Library',
    icon: null,
    displayOrder: 0,
    coverAspectRatio: '2/3',
    watch: false,
    autoScanCronExpression: null,
    metadataPrecedence: [],
    formatPriority: [],
    allowedFormats: [],
    organizationMode: 'book_per_file',
    excludePatterns: [],
    readingThreshold: 10,
    markAsFinishedPercentComplete: 95,
    fileNamingPattern: null,
    fileWriteEnabled: false,
    fileWriteWriteCover: false,
    fileWriteEpubEnabled: false,
    fileWriteEpubMaxFileSizeMb: 100,
    fileWriteFb2Enabled: false,
    fileWriteFb2MaxFileSizeMb: 100,
    fileWritePdfEnabled: false,
    fileWritePdfMaxFileSizeMb: 100,
    fileWriteCbxEnabled: false,
    fileWriteCbxMaxFileSizeMb: 500,
    fileWriteKindleEnabled: false,
    fileWriteKindleMaxFileSizeMb: 100,
    fileWriteAudioEnabled: false,
    fileWriteAudioMaxFileSizeMb: 500,
    fileRenameEnabled: true,
    folders: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function mountView() {
  return shallowMount(BulkRenameView, {
    global: {
      stubs: {
        BulkRenameConfirmDialog: true,
      },
    },
  })
}

describe('BulkRenameView library eligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchLibraries.mockResolvedValue(undefined)
    loadPreview.mockResolvedValue(undefined)
    libraries.value = []
    bulk.selectedLibraryId.value = null
  })

  it('lists every library with file rename enabled and excludes disabled libraries', async () => {
    libraries.value = [
      makeLibrary({ id: 1, name: 'First Enabled Library' }),
      makeLibrary({ id: 2, name: 'Rename Disabled', fileRenameEnabled: false }),
      makeLibrary({ id: 3, name: 'Second Enabled Library' }),
    ]

    const wrapper = mountView()
    await flushPromises()

    const options = wrapper.findAll('select option').slice(1)
    expect(options.map((option) => option.text())).toEqual(['First Enabled Library', 'Second Enabled Library'])
    expect(wrapper.text()).not.toContain('No libraries have file rename enabled')
    expect(fetchLibraries).toHaveBeenCalledOnce()
  })

  it('shows the empty state when every library has file rename disabled', async () => {
    libraries.value = [makeLibrary({ id: 1, fileRenameEnabled: false }), makeLibrary({ id: 2, fileRenameEnabled: false })]

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.findAll('select option')).toHaveLength(1)
    expect(wrapper.text()).toContain('No libraries have file rename enabled')
  })

  it('selects an eligible library and loads its preview', async () => {
    libraries.value = [makeLibrary({ id: 17 })]
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('select').setValue('17')

    expect(selectLibrary).toHaveBeenCalledWith(17)
    expect(loadPreview).toHaveBeenCalledOnce()
  })
})
