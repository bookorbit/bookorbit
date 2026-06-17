import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { shallowMount } from '@vue/test-utils'
import { ENTITY_CAPABILITIES, type BrowseEntityItem } from '@bookorbit/types'

import EntityManagerView from './EntityManagerView.vue'

const mocks = vi.hoisted(() => ({
  useEntityManager: vi.fn<() => unknown>(),
}))

vi.mock('../../composables/useEntityManager', () => ({
  useEntityManager: mocks.useEntityManager,
}))

function makeItem(id: number | string): BrowseEntityItem {
  return {
    id,
    name: `Entity ${id}`,
    bookCount: 1,
  }
}

function mockFn() {
  return vi.fn<(...args: unknown[]) => void>()
}

function makeEntityManagerMock() {
  return {
    entityType: ref('author'),
    mode: ref('browse'),
    isInline: ref(false),
    capabilities: ref(ENTITY_CAPABILITIES.author),

    scanning: ref(false),
    clusters: ref([]),
    scanError: ref(null),
    hasScanned: ref(false),
    minSimilarity: ref(0.5),
    scanLibraryId: ref(undefined),
    scanPage: ref(1),
    scanPageSize: ref(20),
    scanTotal: ref(0),
    scanTotalPages: ref(1),
    scan: mockFn(),
    clearScan: mockFn(),
    duplicateScanStatus: ref(null),
    fetchScanStatus: mockFn(),
    refreshDuplicates: mockFn(),
    removeClustersByIds: mockFn(),
    removePairFromClusters: mockFn(),

    browseItems: ref([1, 2, 3].map(makeItem)),
    browseTotal: ref(3),
    browsePage: ref(1),
    browsePageSize: ref(25),
    browseSearch: ref(''),
    browseSortBy: ref('name'),
    browseSortOrder: ref('asc'),
    browseLoading: ref(false),
    browseTotalPages: ref(1),
    fetchBrowse: mockFn(),
    clearBrowse: mockFn(),

    selectedIds: ref(new Set<number | string>()),
    selectedItemsMap: ref(new Map<number | string, BrowseEntityItem>()),
    toggleSelection: mockFn(),
    rangeSelectTo: mockFn(),
    removeFromSelection: mockFn(),
    clearSelection: mockFn(),

    operationLoading: ref(false),
    operationError: ref(null),
    mergeEntities: mockFn(),
    renameEntity: mockFn(),
    deleteEntity: mockFn(),
    bulkDeleteEntities: mockFn(),
    splitEntity: mockFn(),

    showDismissed: ref(false),
    dismissedPairs: ref([]),
    dismissedLoading: ref(false),
    dismissPair: mockFn(),
    undismissPair: mockFn(),
    fetchDismissedPairs: mockFn(),
  }
}

describe('EntityManagerView selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes ordinary browse selection events to single-item toggle', () => {
    const entityManager = makeEntityManagerMock()
    mocks.useEntityManager.mockReturnValue(entityManager)
    const wrapper = shallowMount(EntityManagerView)

    wrapper.findComponent({ name: 'EntityBrowseTable' }).vm.$emit('select', 2, new MouseEvent('click'))

    expect(entityManager.toggleSelection).toHaveBeenCalledWith(2)
    expect(entityManager.rangeSelectTo).not.toHaveBeenCalled()
  })

  it('routes Shift-click browse selection events to range selection', () => {
    const entityManager = makeEntityManagerMock()
    mocks.useEntityManager.mockReturnValue(entityManager)
    const wrapper = shallowMount(EntityManagerView)

    wrapper.findComponent({ name: 'EntityBrowseTable' }).vm.$emit('select', 3, new MouseEvent('click', { shiftKey: true }))

    expect(entityManager.rangeSelectTo).toHaveBeenCalledWith(3)
    expect(entityManager.toggleSelection).not.toHaveBeenCalled()
  })
})
