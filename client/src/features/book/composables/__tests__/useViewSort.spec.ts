import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import type { SortSpec } from '@bookorbit/types'
import { useViewSort } from '../useViewSort'
import { COLLECTION_DEFAULT_SORT } from '../../lib/sort-defaults'

const mockStorage = new Map<string, string>()

beforeEach(() => {
  mockStorage.clear()
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => mockStorage.get(key) ?? null)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
    mockStorage.set(key, value)
  })
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation((key) => {
    mockStorage.delete(key)
  })
})

describe('useViewSort', () => {
  it('initializes with default sort when no stored value', () => {
    const sort = ref([{ field: 'title' as const, dir: 'asc' as const }])
    const entityId = ref<number | null>(1)

    const { sortModel, isDefaultSort } = useViewSort(sort, 'library', entityId)

    expect(sortModel.value).toEqual([{ field: 'title', dir: 'asc' }])
    expect(isDefaultSort.value).toBe(true)
  })

  it('takes a per-view default so collections open in membership order', () => {
    const sort = ref([{ field: 'title' as const, dir: 'asc' as const }])
    const entityId = ref<number | null>(8)

    const { sortModel, isDefaultSort, resetSort } = useViewSort(sort, 'collection', entityId, COLLECTION_DEFAULT_SORT)

    expect(sortModel.value).toEqual([{ field: 'collectionOrder', dir: 'asc' }])
    expect(isDefaultSort.value).toBe(true)

    sortModel.value = [{ field: 'author', dir: 'desc' }]
    expect(isDefaultSort.value).toBe(false)

    resetSort()
    expect(sortModel.value).toEqual([{ field: 'collectionOrder', dir: 'asc' }])
    expect(isDefaultSort.value).toBe(true)
  })

  it('hands out a copy of the default so one view cannot mutate another', () => {
    const sort = ref<SortSpec[]>([])
    const entityId = ref<number | null>(9)

    const { sortModel } = useViewSort(sort, 'collection', entityId, COLLECTION_DEFAULT_SORT)
    sortModel.value[0]!.dir = 'desc'

    expect(COLLECTION_DEFAULT_SORT).toEqual([{ field: 'collectionOrder', dir: 'asc' }])
  })

  it('loads stored sort from localStorage on init', () => {
    const stored = JSON.stringify([{ field: 'author', dir: 'desc' }])
    mockStorage.set('bookorbit:sort:library:5', stored)

    const sort = ref([{ field: 'title' as const, dir: 'asc' as const }])
    const entityId = ref<number | null>(5)

    const { sortModel, isDefaultSort } = useViewSort(sort, 'library', entityId)

    expect(sortModel.value).toEqual([{ field: 'author', dir: 'desc' }])
    expect(isDefaultSort.value).toBe(false)
  })

  it('persists sort to localStorage on sortModel write', () => {
    const sort = ref([{ field: 'title' as const, dir: 'asc' as const }])
    const entityId = ref<number | null>(3)

    const { sortModel } = useViewSort(sort, 'library', entityId)
    sortModel.value = [{ field: 'rating', dir: 'desc' }]

    expect(mockStorage.get('bookorbit:sort:library:3')).toBe(JSON.stringify([{ field: 'rating', dir: 'desc' }]))
  })

  it('falls back to default when sortModel set to empty', () => {
    const sort = ref([{ field: 'title' as const, dir: 'asc' as const }])
    const entityId = ref<number | null>(1)

    const { sortModel } = useViewSort(sort, 'library', entityId)
    sortModel.value = []

    expect(sortModel.value).toEqual([{ field: 'title', dir: 'asc' }])
  })

  it('resets sort and removes from localStorage', () => {
    mockStorage.set('bookorbit:sort:library:7', JSON.stringify([{ field: 'author', dir: 'asc' }]))
    const sort = ref([{ field: 'title' as const, dir: 'asc' as const }])
    const entityId = ref<number | null>(7)

    const { resetSort, isDefaultSort } = useViewSort(sort, 'library', entityId)

    expect(isDefaultSort.value).toBe(false)
    resetSort()
    expect(isDefaultSort.value).toBe(true)
    expect(mockStorage.has('bookorbit:sort:library:7')).toBe(false)
  })

  it('produces correct sortSummary', () => {
    const sort = ref([{ field: 'title' as const, dir: 'asc' as const }])
    const entityId = ref<number | null>(1)

    const { sortModel, sortSummary } = useViewSort(sort, 'library', entityId)

    expect(sortSummary.value).toBe('Title ↑')

    sortModel.value = [
      { field: 'author', dir: 'asc' },
      { field: 'title', dir: 'desc' },
    ]
    expect(sortSummary.value).toBe('Author ↑, Title ↓')
  })

  it('reloads sort when entityId changes', async () => {
    mockStorage.set('bookorbit:sort:test:1', JSON.stringify([{ field: 'author', dir: 'asc' }]))
    mockStorage.set('bookorbit:sort:test:2', JSON.stringify([{ field: 'series', dir: 'desc' }]))

    const sort = ref([{ field: 'title' as const, dir: 'asc' as const }])
    const entityId = ref<number | null>(1)

    const { sortModel } = useViewSort(sort, 'test', entityId)
    expect(sortModel.value).toEqual([{ field: 'author', dir: 'asc' }])

    entityId.value = 2
    await nextTick()
    expect(sortModel.value).toEqual([{ field: 'series', dir: 'desc' }])
  })

  it('handles null entityId gracefully', () => {
    const sort = ref([{ field: 'title' as const, dir: 'asc' as const }])
    const entityId = ref<number | null>(null)

    const { sortModel, saveSort, resetSort } = useViewSort(sort, 'library', entityId)

    expect(sortModel.value).toEqual([{ field: 'title', dir: 'asc' }])
    expect(() => saveSort()).not.toThrow()
    expect(() => resetSort()).not.toThrow()
  })

  it('handles corrupted localStorage gracefully', () => {
    mockStorage.set('bookorbit:sort:library:9', 'not valid json{{{')

    const sort = ref([{ field: 'title' as const, dir: 'asc' as const }])
    const entityId = ref<number | null>(9)

    const { sortModel } = useViewSort(sort, 'library', entityId)

    expect(sortModel.value).toEqual([{ field: 'title', dir: 'asc' }])
  })

  it('uses different key prefixes for different view types', () => {
    const sort = ref([{ field: 'title' as const, dir: 'asc' as const }])
    const entityId = ref<number | null>(1)

    const { sortModel } = useViewSort(sort, 'collection', entityId)
    sortModel.value = [{ field: 'rating', dir: 'desc' }]

    expect(mockStorage.has('bookorbit:sort:collection:1')).toBe(true)
    expect(mockStorage.has('bookorbit:sort:library:1')).toBe(false)
  })
})

describe('useViewSort with a default that arrives later', () => {
  it('re-reads once the default is known, and a stored sort still wins', () => {
    const sort = ref<SortSpec[]>([])
    const entityId = ref<number | null>(3)
    const scopeDefault = ref<SortSpec[]>([{ field: 'title', dir: 'asc' }])

    const { sortModel, isDefaultSort, loadSort, resetSort } = useViewSort(sort, 'smartScope', entityId, scopeDefault)
    expect(sortModel.value).toEqual([{ field: 'title', dir: 'asc' }])

    scopeDefault.value = [{ field: 'addedAt', dir: 'desc' }]
    loadSort()
    expect(sortModel.value).toEqual([{ field: 'addedAt', dir: 'desc' }])
    expect(isDefaultSort.value).toBe(true)

    sortModel.value = [{ field: 'author', dir: 'asc' }]
    loadSort()
    expect(sortModel.value).toEqual([{ field: 'author', dir: 'asc' }])
    expect(isDefaultSort.value).toBe(false)

    resetSort()
    expect(sortModel.value).toEqual([{ field: 'addedAt', dir: 'desc' }])
  })
})
