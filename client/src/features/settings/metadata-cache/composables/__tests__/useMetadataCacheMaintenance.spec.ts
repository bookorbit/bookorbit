import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cacheClearUrl, useMetadataCacheMaintenance } from '../useMetadataCacheMaintenance'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>(),
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
}))

vi.mock('@/lib/api', () => ({ api: mocks.api }))
vi.mock('vue-sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }))

function setup() {
  let state!: ReturnType<typeof useMetadataCacheMaintenance>
  mount(
    defineComponent({
      setup() {
        state = useMetadataCacheMaintenance()
        return () => null
      },
    }),
  )
  return state
}

describe('useMetadataCacheMaintenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('builds a clear URL for each scope', () => {
    expect(cacheClearUrl('all')).toBe('/api/v1/metadata-cache')
    expect(cacheClearUrl('book')).toBe('/api/v1/metadata-cache?namespace=book')
    expect(cacheClearUrl('author')).toBe('/api/v1/metadata-cache?namespace=author')
    expect(cacheClearUrl('empty')).toBe('/api/v1/metadata-cache?emptyOnly=true')
  })

  it('loads stats', async () => {
    const stats = { entries: 3 }
    mocks.api.mockResolvedValue({ ok: true, json: async () => stats })
    const state = setup()

    await state.loadStats()

    expect(mocks.api).toHaveBeenCalledWith('/api/v1/metadata-cache/stats')
    expect(state.stats.value).toEqual(stats)
    expect(state.statsFailed.value).toBe(false)
  })

  it('clears with DELETE, reports the count and reloads stats', async () => {
    mocks.api.mockImplementation(async (url) =>
      url.startsWith('/api/v1/metadata-cache/stats')
        ? { ok: true, json: async () => ({ entries: 0 }) }
        : { ok: true, json: async () => ({ deleted: 12, pending: false }) },
    )
    const state = setup()

    await expect(state.clear('empty')).resolves.toEqual({ deleted: 12, pending: false })

    expect(mocks.api).toHaveBeenCalledWith('/api/v1/metadata-cache?emptyOnly=true', { method: 'DELETE' })
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/metadata-cache/stats')
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1)
    expect(state.clearing.value).toBeNull()
  })

  it('reports a failed clear without reloading stats', async () => {
    mocks.api.mockResolvedValue({ ok: false, json: async () => ({}) })
    const state = setup()

    await expect(state.clear('all')).resolves.toBeNull()

    expect(mocks.api).toHaveBeenCalledTimes(1)
    expect(mocks.toastError).toHaveBeenCalledTimes(1)
  })
})
