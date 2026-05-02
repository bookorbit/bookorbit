import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { useViewSort } from '../useViewSort'

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
