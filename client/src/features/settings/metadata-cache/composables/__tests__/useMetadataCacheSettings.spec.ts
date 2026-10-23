import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_METADATA_CACHE_CONFIG, type MetadataCacheConfig, type MetadataCacheConfigResponse } from '@bookorbit/types'
import { useMetadataCacheSettings } from '../useMetadataCacheSettings'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>(),
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
}))

vi.mock('@/lib/api', () => ({ api: mocks.api }))
vi.mock('vue-sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }))

function response(config: MetadataCacheConfig): MetadataCacheConfigResponse {
  return {
    config,
    providers: [
      { namespace: 'book', provider: 'google', label: 'Google Books', cacheable: true, cachesEmptyResults: true },
      { namespace: 'author', provider: 'goodreads', label: 'Goodreads', cacheable: true, cachesEmptyResults: false },
    ],
  }
}

function ok(data: unknown) {
  return { ok: true, json: async () => data }
}

function setup() {
  let state!: ReturnType<typeof useMetadataCacheSettings>
  mount(
    defineComponent({
      setup() {
        state = useMetadataCacheSettings()
        return () => null
      },
    }),
  )
  return state
}

describe('useMetadataCacheSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads the config and starts clean', async () => {
    mocks.api.mockResolvedValue(ok(response(DEFAULT_METADATA_CACHE_CONFIG)))
    const state = setup()

    await expect(state.load()).resolves.toBe(true)

    expect(mocks.api).toHaveBeenCalledWith('/api/v1/metadata-cache/config')
    expect(state.draft.value?.resultsTtl).toEqual({ amount: 7, unit: 'days' })
    expect(state.isDirty.value).toBe(false)
    expect(state.canSave.value).toBe(false)
  })

  it('reports a failed load', async () => {
    mocks.api.mockResolvedValue({ ok: false, json: async () => ({}) })
    const state = setup()

    await expect(state.load()).resolves.toBe(false)
    expect(state.loadFailed.value).toBe(true)
  })

  it('blocks saving while a field is invalid', async () => {
    mocks.api.mockResolvedValue(ok(response(DEFAULT_METADATA_CACHE_CONFIG)))
    const state = setup()
    await state.load()

    state.setMaxStorageMb(10)

    expect(state.isDirty.value).toBe(true)
    expect(state.isValid.value).toBe(false)
    expect(state.canSave.value).toBe(false)
    await expect(state.save()).resolves.toBe(false)
    expect(mocks.api).toHaveBeenCalledTimes(1)
  })

  it('saves the whole config, including provider overrides, and adopts the server answer', async () => {
    const savedConfig: MetadataCacheConfig = {
      ...DEFAULT_METADATA_CACHE_CONFIG,
      emptyTtlSeconds: 0,
      providerOverrides: [{ namespace: 'book', provider: 'google', resultsTtlSeconds: 2 * 86_400 }],
    }
    mocks.api.mockResolvedValueOnce(ok(response(DEFAULT_METADATA_CACHE_CONFIG))).mockResolvedValueOnce(ok(response(savedConfig)))
    const state = setup()
    await state.load()

    state.setDuration('emptyTtl', { amount: 0, unit: 'days' })
    state.setOverride({ ...state.draft.value!.overrides['book:google']!, resultsTtl: { amount: 48, unit: 'hours' } })
    expect(state.canSave.value).toBe(true)

    await expect(state.save()).resolves.toBe(true)

    const [url, init] = mocks.api.mock.calls[1]!
    expect(url).toBe('/api/v1/metadata-cache/config')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(String(init?.body))).toEqual(savedConfig)
    expect(state.isDirty.value).toBe(false)
    expect(state.draft.value?.overrides['book:google']?.resultsTtl).toEqual({ amount: 2, unit: 'days' })
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1)
  })

  it('keeps the edits and reports a rejected save', async () => {
    mocks.api.mockResolvedValueOnce(ok(response(DEFAULT_METADATA_CACHE_CONFIG))).mockResolvedValueOnce({ ok: false, json: async () => ({}) })
    const state = setup()
    await state.load()

    state.setEnabled(false)
    await expect(state.save()).resolves.toBe(false)

    expect(state.draft.value?.enabled).toBe(false)
    expect(state.isDirty.value).toBe(true)
    expect(mocks.toastError).toHaveBeenCalledTimes(1)
  })

  it('discards edits back to the saved config and resets a provider', async () => {
    mocks.api.mockResolvedValue(
      ok(response({ ...DEFAULT_METADATA_CACHE_CONFIG, providerOverrides: [{ namespace: 'author', provider: 'goodreads', enabled: false }] })),
    )
    const state = setup()
    await state.load()

    state.resetOverride('author:goodreads')
    expect(state.draft.value?.overrides['author:goodreads']?.enabled).toBe(true)
    expect(state.isDirty.value).toBe(true)

    state.discard()
    expect(state.draft.value?.overrides['author:goodreads']?.enabled).toBe(false)
    expect(state.isDirty.value).toBe(false)
  })
})
