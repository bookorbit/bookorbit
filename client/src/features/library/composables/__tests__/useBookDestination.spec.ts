import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBookDestination } from '../useBookDestination'
import { makeLibrary } from '../../test/fixtures'
import type { Library } from '@bookorbit/types'

const libraries = ref<Library[]>([])
const loaded = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)
const fetchLibraries = vi.fn<() => Promise<void>>()
const refreshLibraries = vi.fn<() => Promise<void>>()
vi.mock('../useLibraries', () => ({
  useLibraries: () => ({
    libraries,
    loaded,
    loading,
    error,
    fetchLibraries,
    refreshLibraries,
  }),
}))
let scope = effectScope()
function destination(options: Parameters<typeof useBookDestination>[0] = {}) {
  return scope.run(() => useBookDestination(options))!
}

beforeEach(() => {
  scope = effectScope()
  libraries.value = []
  loaded.value = false
  loading.value = false
  error.value = null
  fetchLibraries.mockReset().mockResolvedValue(undefined)
  refreshLibraries.mockReset().mockResolvedValue(undefined)
})
afterEach(() => scope.stop())

function load(items: Library[]) {
  libraries.value = items
  loaded.value = true
}

describe('useBookDestination', () => {
  it('selects the sole book library and its folder after the list finishes loading', async () => {
    const state = destination()
    libraries.value = [makeLibrary()]
    loading.value = true
    await nextTick()
    expect(state.libraryId.value).toBeNull()
    expect(state.hasDestination.value).toBe(false)
    loaded.value = true
    loading.value = false
    await nextTick()
    expect(state.libraryId.value).toBe(3)
    expect(state.folderId.value).toBe(30)
    expect(state.hasDestination.value).toBe(true)
  })

  it('uses a cached list immediately and excludes podcast libraries', () => {
    load([makeLibrary({ id: 1, type: 'podcasts' }), makeLibrary()])
    const state = destination()
    expect(state.libraries.value.map((library) => library.id)).toEqual([3])
    expect(state.libraryId.value).toBe(3)
    expect(state.hasDestination.value).toBe(true)
  })

  it('requires a choice when there are multiple libraries', () => {
    load([makeLibrary({ id: 1 }), makeLibrary()])
    const state = destination()
    expect(state.libraryId.value).toBeNull()
    expect(state.folderId.value).toBeNull()
    expect(state.hasDestination.value).toBe(false)
  })

  it('preserves the existing Dock first-library default when requested', () => {
    load([makeLibrary({ id: 1 }), makeLibrary()])
    const state = destination({ defaultToFirstLibrary: true })
    expect(state.libraryId.value).toBe(1)
    expect(state.folderId.value).toBe(30)
  })

  it.each([[], [makeLibrary({ type: 'podcasts' })], [makeLibrary({ folders: [] })]].map((items) => ({ items })))(
    'does not report a destination for an empty library or folder list',
    ({ items }) => {
      load(items)
      expect(destination().hasDestination.value).toBe(false)
    },
  )

  it('preserves a carried library and non-first folder across loading and refreshes', async () => {
    const state = destination({ libraryId: 3, folderId: 31 })
    const library = makeLibrary()
    library.folders.push({ ...library.folders[0]!, id: 31, path: '/books/second' })
    load([makeLibrary({ id: 1 }), library])
    await nextTick()
    expect(state.libraryId.value).toBe(3)
    expect(state.folderId.value).toBe(31)
    libraries.value = [library, makeLibrary({ id: 1 })]
    await nextTick()
    expect(state.folderId.value).toBe(31)
    expect(state.hasDestination.value).toBe(true)
  })

  it('fills a missing folder in the carried library', () => {
    load([makeLibrary({ id: 1 }), makeLibrary()])
    const state = destination({ libraryId: 3 })
    expect(state.libraryId.value).toBe(3)
    expect(state.folderId.value).toBe(30)
  })

  it('changes folders with the selected library and keeps manual selections after refresh', async () => {
    const second = makeLibrary({ id: 4, folders: [{ id: 40, path: '/comics', role: 'downloads', createdAt: '2026-01-01' }] })
    second.folders.push({ ...second.folders[0]!, id: 41 })
    load([makeLibrary(), second])
    const state = destination()
    state.selectLibrary(4)
    state.selectFolder(41)
    await nextTick()
    expect(state.hasDestination.value).toBe(true)
    libraries.value = [makeLibrary(), second]
    await nextTick()
    expect(state.libraryId.value).toBe(4)
    expect(state.folderId.value).toBe(41)
    state.selectLibrary(3)
    expect(state.folderId.value).toBe(30)
  })

  it('clears the previous folder when a library has no folders', async () => {
    load([makeLibrary(), makeLibrary({ id: 4, folders: [] })])
    const state = destination({ libraryId: 3 })
    state.selectLibrary(4)
    await nextTick()
    expect(state.folderId.value).toBeNull()
    expect(state.hasDestination.value).toBe(false)
  })

  it.each([
    { libraryId: 99, folderId: 30 },
    { libraryId: 3, folderId: 99 },
  ])('preserves unavailable carried IDs without treating them as valid', (carried) => {
    load([makeLibrary()])
    const state = destination(carried)
    expect(state.libraryId.value).toBe(carried.libraryId)
    expect(state.folderId.value).toBe(carried.folderId)
    expect(state.hasDestination.value).toBe(false)
  })

  it('invalidates a destination when its library or folder disappears', async () => {
    load([makeLibrary()])
    const state = destination()
    libraries.value = [makeLibrary({ folders: [] })]
    await nextTick()
    expect(state.hasDestination.value).toBe(false)
    expect(state.folderId.value).toBe(30)
    libraries.value = []
    await nextTick()
    expect(state.hasDestination.value).toBe(false)
    expect(state.libraryId.value).toBe(3)
  })

  it('blocks cached destinations while refreshing or after a failed request', async () => {
    load([makeLibrary()])
    const state = destination()
    loading.value = true
    await nextTick()
    expect(state.hasDestination.value).toBe(false)
    loading.value = false
    error.value = 'HTTP 503'
    await nextTick()
    expect(state.hasDestination.value).toBe(false)
    error.value = null
    await nextTick()
    expect(state.hasDestination.value).toBe(true)
  })

  it('does not infer a default from a failed load', () => {
    load([makeLibrary()])
    error.value = 'HTTP 503'
    const state = destination()
    expect(state.libraryId.value).toBeNull()
    expect(state.folderId.value).toBeNull()
  })

  it('resets both carried IDs when switching Dock files', async () => {
    load([makeLibrary(), makeLibrary({ id: 4, folders: [{ id: 40, path: '/comics', role: 'downloads', createdAt: '2026-01-01' }] })])
    const state = destination({ defaultToFirstLibrary: true })
    state.reset(4, 40)
    await nextTick()
    expect(state.libraryId.value).toBe(4)
    expect(state.folderId.value).toBe(40)
    state.reset(null, null)
    await nextTick()
    expect(state.libraryId.value).toBe(3)
    expect(state.folderId.value).toBe(30)
  })
  it('uses the normal cached fetch when no previous request failed', async () => {
    const state = destination()
    await state.fetchLibraries()
    expect(fetchLibraries).toHaveBeenCalledExactlyOnceWith()
    expect(refreshLibraries).not.toHaveBeenCalled()
  })

  it('retries a failed refresh even when a library list was already cached', async () => {
    load([makeLibrary()])
    error.value = 'HTTP 503'
    const state = destination()
    refreshLibraries.mockImplementation(async () => {
      error.value = null
    })
    await state.fetchLibraries()
    await nextTick()
    expect(refreshLibraries).toHaveBeenCalledExactlyOnceWith()
    expect(fetchLibraries).not.toHaveBeenCalled()
    expect(state.hasDestination.value).toBe(true)
  })
})
