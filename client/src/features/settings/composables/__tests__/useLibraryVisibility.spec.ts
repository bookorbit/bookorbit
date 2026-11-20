import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, type Ref } from 'vue'
import { normalizeHiddenLibraries, useLibraryVisibility } from '../useLibraryVisibility'

type TestUser = { id: number; settings: Record<string, unknown> }

const state = vi.hoisted(() => ({
  user: null as unknown as Ref<TestUser | null>,
  api: vi.fn<(url: string, init?: RequestInit) => Promise<{ ok: boolean }>>(),
}))

vi.mock('@/features/auth/composables/useAuth', () => ({ useAuth: () => ({ user: state.user }) }))
vi.mock('@/lib/api', () => ({ api: state.api }))

function sentBody(call = 0): unknown {
  return JSON.parse(String(state.api.mock.calls[call]![1]!.body))
}

beforeEach(() => {
  vi.clearAllMocks()
  state.user = ref<TestUser | null>({ id: 7, settings: {} })
  state.api.mockResolvedValue({ ok: true })
})

describe('normalizeHiddenLibraries', () => {
  it('keeps positive ids per place, deduplicated and sorted, and ignores the rest', () => {
    expect(normalizeHiddenLibraries({ shelves: [4, 2, 4, 0, -1, 1.5, '3'], stats: 'all', other: [9] })).toEqual({
      shelves: [2, 4],
      series: [],
      stats: [],
    })
    expect(normalizeHiddenLibraries(undefined)).toEqual({ shelves: [], series: [], stats: [] })
    expect(normalizeHiddenLibraries([1])).toEqual({ shelves: [], series: [], stats: [] })
  })
})

describe('useLibraryVisibility', () => {
  it('shows every library everywhere when nothing is stored', () => {
    const visibility = useLibraryVisibility()

    expect(visibility.anyHidden.value).toBe(false)
    expect(visibility.isHidden(1, 'stats')).toBe(false)
  })

  it('hides a library from one place and saves the whole hidden list under its own settings key', async () => {
    const visibility = useLibraryVisibility()

    await expect(visibility.setHidden(3, 'stats', true)).resolves.toBe(true)

    expect(state.api).toHaveBeenCalledWith('/api/v1/users/me/settings', expect.objectContaining({ method: 'PATCH' }))
    expect(sentBody()).toEqual({ settings: { libraryVisibility: { hidden: { shelves: [], series: [], stats: [3] } } } })
    expect(visibility.isHidden(3, 'stats')).toBe(true)
    expect(visibility.placesHiding(3)).toEqual(['stats'])
    expect(visibility.anyHidden.value).toBe(true)
  })

  it('shows the change at once and takes it back when the save fails', async () => {
    let resolve!: (value: { ok: boolean }) => void
    state.api.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    const visibility = useLibraryVisibility()

    const saving = visibility.setHidden(5, 'series', true)
    expect(visibility.isHidden(5, 'series')).toBe(true)

    resolve({ ok: false })
    await expect(saving).resolves.toBe(false)
    expect(visibility.isHidden(5, 'series')).toBe(false)
  })

  it('sends quick toggles one after another, each with the latest state', async () => {
    const visibility = useLibraryVisibility()

    await Promise.all([visibility.setHidden(1, 'shelves', true), visibility.setHidden(2, 'shelves', true)])

    expect(state.api).toHaveBeenCalledTimes(2)
    expect(sentBody(1)).toEqual({ settings: { libraryVisibility: { hidden: { shelves: [1, 2], series: [], stats: [] } } } })
  })

  it('skips the request when the library is already in the asked state', async () => {
    state.user.value = { id: 7, settings: { libraryVisibility: { hidden: { stats: [3] } } } }
    const visibility = useLibraryVisibility()

    await expect(visibility.setHidden(3, 'stats', true)).resolves.toBe(true)
    expect(state.api).not.toHaveBeenCalled()
  })

  it('shows every library everywhere again', async () => {
    state.user.value = { id: 7, settings: { libraryVisibility: { hidden: { shelves: [1], series: [2], stats: [1, 2] } } } }
    const visibility = useLibraryVisibility()

    await expect(visibility.showEverywhere()).resolves.toBe(true)

    expect(sentBody()).toEqual({ settings: { libraryVisibility: { hidden: { shelves: [], series: [], stats: [] } } } })
    expect(visibility.anyHidden.value).toBe(false)
  })
})
