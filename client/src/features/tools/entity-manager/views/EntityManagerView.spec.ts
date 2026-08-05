import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { flushPromises, shallowMount } from '@vue/test-utils'
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
    browseBookCount: ref('any'),
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

  it('loads browse mode exactly once on mount', () => {
    const entityManager = makeEntityManagerMock()
    mocks.useEntityManager.mockReturnValue(entityManager)

    shallowMount(EntityManagerView)

    expect(entityManager.fetchBrowse).toHaveBeenCalledTimes(1)
  })

  it('refreshes exactly once when an entity change also resets pagination', async () => {
    const entityManager = makeEntityManagerMock()
    entityManager.browsePage.value = 3
    mocks.useEntityManager.mockReturnValue(entityManager)
    shallowMount(EntityManagerView)
    entityManager.fetchBrowse.mockClear()

    entityManager.entityType.value = 'series'
    entityManager.browsePage.value = 1
    await nextTick()

    expect(entityManager.fetchBrowse).toHaveBeenCalledTimes(1)
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

  it('resets to the first page and refreshes when empty-only filtering changes', async () => {
    const entityManager = makeEntityManagerMock()
    entityManager.browsePage.value = 3
    mocks.useEntityManager.mockReturnValue(entityManager)
    const wrapper = shallowMount(EntityManagerView)
    entityManager.fetchBrowse.mockClear()

    wrapper.findComponent({ name: 'EntityBrowseTable' }).vm.$emit('update:bookCount', 'empty')

    expect(entityManager.browseBookCount.value).toBe('empty')
    expect(entityManager.browsePage.value).toBe(1)
    await nextTick()
    expect(entityManager.fetchBrowse).toHaveBeenCalledTimes(1)
  })

  it('refreshes immediately when empty-only filtering changes on the first page', () => {
    const entityManager = makeEntityManagerMock()
    mocks.useEntityManager.mockReturnValue(entityManager)
    const wrapper = shallowMount(EntityManagerView)
    entityManager.fetchBrowse.mockClear()

    wrapper.findComponent({ name: 'EntityBrowseTable' }).vm.$emit('update:bookCount', 'empty')

    expect(entityManager.browseBookCount.value).toBe('empty')
    expect(entityManager.fetchBrowse).toHaveBeenCalledTimes(1)
  })

  it('updates browse sort atomically and refreshes once', () => {
    const entityManager = makeEntityManagerMock()
    mocks.useEntityManager.mockReturnValue(entityManager)
    const wrapper = shallowMount(EntityManagerView)
    entityManager.fetchBrowse.mockClear()

    wrapper.findComponent({ name: 'EntityBrowseTable' }).vm.$emit('sortChange', 'bookCount', 'desc')

    expect(entityManager.browseSortBy.value).toBe('bookCount')
    expect(entityManager.browseSortOrder.value).toBe('desc')
    expect(entityManager.fetchBrowse).toHaveBeenCalledTimes(1)
  })

  it('defaults single zero-book deletes to hard delete', async () => {
    const entityManager = makeEntityManagerMock()
    mocks.useEntityManager.mockReturnValue(entityManager)
    const wrapper = shallowMount(EntityManagerView)

    wrapper.findComponent({ name: 'EntityBrowseTable' }).vm.$emit('delete', { id: 7, name: 'Unused', bookCount: 0 })
    await nextTick()

    expect(wrapper.findComponent({ name: 'DeleteModal' }).props('defaultMode')).toBe('hard')
  })

  it('keeps single non-empty deletes on soft delete by default', async () => {
    const entityManager = makeEntityManagerMock()
    mocks.useEntityManager.mockReturnValue(entityManager)
    const wrapper = shallowMount(EntityManagerView)

    wrapper.findComponent({ name: 'EntityBrowseTable' }).vm.$emit('delete', { id: 7, name: 'Used', bookCount: 2 })
    await nextTick()

    expect(wrapper.findComponent({ name: 'DeleteModal' }).props('defaultMode')).toBe('soft')
  })

  it('defaults bulk deletes to hard only when all selected entities are empty', async () => {
    const entityManager = makeEntityManagerMock()
    entityManager.selectedIds.value = new Set([1, 2])
    entityManager.selectedItemsMap.value = new Map([
      [1, { id: 1, name: 'Unused 1', bookCount: 0 }],
      [2, { id: 2, name: 'Unused 2', bookCount: 0 }],
    ])
    mocks.useEntityManager.mockReturnValue(entityManager)
    const wrapper = shallowMount(EntityManagerView)

    wrapper.findComponent({ name: 'EntityBrowseTable' }).vm.$emit('bulkDelete')
    await nextTick()

    expect(wrapper.findComponent({ name: 'BulkDeleteModal' }).props('defaultMode')).toBe('hard')
  })

  it('keeps mixed bulk deletes on soft delete by default', async () => {
    const entityManager = makeEntityManagerMock()
    entityManager.selectedIds.value = new Set([1, 2])
    entityManager.selectedItemsMap.value = new Map([
      [1, { id: 1, name: 'Unused', bookCount: 0 }],
      [2, { id: 2, name: 'Used', bookCount: 4 }],
    ])
    mocks.useEntityManager.mockReturnValue(entityManager)
    const wrapper = shallowMount(EntityManagerView)

    wrapper.findComponent({ name: 'EntityBrowseTable' }).vm.$emit('bulkDelete')
    await nextTick()

    expect(wrapper.findComponent({ name: 'BulkDeleteModal' }).props('defaultMode')).toBe('soft')
  })

  it('forces empty-only updates back to any for inline entity types', () => {
    const entityManager = makeEntityManagerMock()
    entityManager.isInline.value = true
    mocks.useEntityManager.mockReturnValue(entityManager)
    const wrapper = shallowMount(EntityManagerView)
    entityManager.fetchBrowse.mockClear()

    wrapper.findComponent({ name: 'EntityBrowseTable' }).vm.$emit('update:bookCount', 'empty')

    expect(entityManager.browseBookCount.value).toBe('any')
    expect(entityManager.fetchBrowse).toHaveBeenCalledTimes(1)
  })

  it('renames a browsed entity and refreshes results', async () => {
    const entityManager = makeEntityManagerMock()
    mocks.useEntityManager.mockReturnValue(entityManager)
    const wrapper = shallowMount(EntityManagerView)
    const item = { id: 4, name: 'Old Name', bookCount: 1 }

    wrapper.findComponent({ name: 'EntityBrowseTable' }).vm.$emit('rename', item)
    await nextTick()
    wrapper.findComponent({ name: 'RenameModal' }).vm.$emit('confirm', 'New Name', true)
    await flushPromises()

    expect(entityManager.renameEntity).toHaveBeenCalledWith(4, 'New Name', true)
    expect(entityManager.fetchBrowse).toHaveBeenCalled()
    expect(wrapper.findComponent({ name: 'RenameModal' }).exists()).toBe(false)
  })

  it('deletes a browsed entity, clears its selection, and refreshes results', async () => {
    const entityManager = makeEntityManagerMock()
    mocks.useEntityManager.mockReturnValue(entityManager)
    const wrapper = shallowMount(EntityManagerView)
    const item = { id: 5, name: 'Unused', bookCount: 0 }

    wrapper.findComponent({ name: 'EntityBrowseTable' }).vm.$emit('delete', item)
    await nextTick()
    wrapper.findComponent({ name: 'DeleteModal' }).vm.$emit('confirm', 'hard', true)
    await flushPromises()

    expect(entityManager.deleteEntity).toHaveBeenCalledWith(5, 'hard', true)
    expect(entityManager.removeFromSelection).toHaveBeenCalledWith(5)
    expect(entityManager.fetchBrowse).toHaveBeenCalled()
    expect(wrapper.findComponent({ name: 'DeleteModal' }).exists()).toBe(false)
  })

  it('splits a browsed entity, clears its selection, and refreshes results', async () => {
    const entityManager = makeEntityManagerMock()
    mocks.useEntityManager.mockReturnValue(entityManager)
    const wrapper = shallowMount(EntityManagerView)
    const item = { id: 6, name: 'Combined', bookCount: 2 }

    wrapper.findComponent({ name: 'EntityBrowseTable' }).vm.$emit('split', item)
    await nextTick()
    wrapper.findComponent({ name: 'SplitModal' }).vm.$emit('confirm', ['A', 'B'], false)
    await flushPromises()

    expect(entityManager.splitEntity).toHaveBeenCalledWith(6, ['A', 'B'], false)
    expect(entityManager.removeFromSelection).toHaveBeenCalledWith(6)
    expect(entityManager.fetchBrowse).toHaveBeenCalled()
    expect(wrapper.findComponent({ name: 'SplitModal' }).exists()).toBe(false)
  })

  it('bulk deletes selected entities, clears selection, and refreshes results', async () => {
    const entityManager = makeEntityManagerMock()
    entityManager.selectedIds.value = new Set([1, 2])
    mocks.useEntityManager.mockReturnValue(entityManager)
    const wrapper = shallowMount(EntityManagerView)

    wrapper.findComponent({ name: 'EntityBrowseTable' }).vm.$emit('bulkDelete')
    await nextTick()
    wrapper.findComponent({ name: 'BulkDeleteModal' }).vm.$emit('confirm', 'soft', false)
    await flushPromises()

    expect(entityManager.bulkDeleteEntities).toHaveBeenCalledWith([1, 2], 'soft', false)
    expect(entityManager.clearSelection).toHaveBeenCalled()
    expect(entityManager.fetchBrowse).toHaveBeenCalled()
    expect(wrapper.findComponent({ name: 'BulkDeleteModal' }).exists()).toBe(false)
  })

  it('merges selected browse entities, clears selection, and refreshes results', async () => {
    const entityManager = makeEntityManagerMock()
    entityManager.selectedItemsMap.value = new Map([
      [1, { id: 1, name: 'Target', bookCount: 2 }],
      [2, { id: 2, name: 'Source', bookCount: 1 }],
    ])
    mocks.useEntityManager.mockReturnValue(entityManager)
    const wrapper = shallowMount(EntityManagerView)

    wrapper.findComponent({ name: 'EntityBrowseTable' }).vm.$emit('bulkMerge')
    await nextTick()
    wrapper.findComponent({ name: 'BrowseMergeModal' }).vm.$emit('confirm', 1, [2], true)
    await flushPromises()

    expect(entityManager.mergeEntities).toHaveBeenCalledWith(1, [2], true)
    expect(entityManager.clearSelection).toHaveBeenCalled()
    expect(entityManager.fetchBrowse).toHaveBeenCalled()
    expect(wrapper.findComponent({ name: 'BrowseMergeModal' }).exists()).toBe(false)
  })
})
