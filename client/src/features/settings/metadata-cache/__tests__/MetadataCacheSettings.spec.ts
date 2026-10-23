import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_METADATA_CACHE_CONFIG, type MetadataCacheConfigResponse, type MetadataCacheStats } from '@bookorbit/types'
import { activateI18nLocale } from '@/i18n'
import MetadataCacheSettings from '../MetadataCacheSettings.vue'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>(),
  permissions: new Set<string>(),
}))

vi.mock('@/lib/api', () => ({ api: mocks.api }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn<(message: string) => void>(), error: vi.fn<(message: string) => void>() } }))
vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (name: string) => mocks.permissions.has(name) }),
}))

const CONFIG_RESPONSE: MetadataCacheConfigResponse = {
  config: DEFAULT_METADATA_CACHE_CONFIG,
  providers: [
    { namespace: 'book', provider: 'google', label: 'Google Books', cacheable: true, cachesEmptyResults: true },
    { namespace: 'book', provider: 'amazon', label: 'Amazon', cacheable: true, cachesEmptyResults: false },
    { namespace: 'author', provider: 'audnexus', label: 'Audnexus', cacheable: false, cachesEmptyResults: false },
  ],
}

const STATS: MetadataCacheStats = {
  entries: 120,
  payloadBytes: 1_048_576,
  relationBytes: 2_097_152,
  maxStorageBytes: 536_870_912,
  oldestFetchedAt: null,
  providers: [{ namespace: 'book', provider: 'google', entries: 100, emptyEntries: 4, payloadBytes: 900_000 }],
  counters: { hits: 30, misses: 10, fallbacks: 5, liveCalls: 10, writes: 10, skippedWrites: 2, writeFailures: 0, readFailures: 0, uncacheable: {} },
  sweepRunning: false,
  lastSweepAt: null,
}

function ok(data: unknown) {
  return { ok: true, json: async () => data }
}

function routeApi() {
  mocks.api.mockImplementation(async (url, init) => {
    if (url === '/api/v1/metadata-cache/config') return ok(CONFIG_RESPONSE)
    if (url === '/api/v1/metadata-cache/stats') return ok(STATS)
    if (init?.method === 'DELETE') return ok({ deleted: 4, pending: false })
    return { ok: false, json: async () => ({}) }
  })
}

async function mountPage() {
  const wrapper = mount(MetadataCacheSettings, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

describe('MetadataCacheSettings', () => {
  beforeEach(() => {
    activateI18nLocale('en')
    mocks.api.mockReset()
    mocks.permissions = new Set(['manage_metadata_config'])
    routeApi()
  })

  it('loads nothing and explains why without the metadata config permission', async () => {
    mocks.permissions = new Set()
    const wrapper = await mountPage()

    expect(mocks.api).not.toHaveBeenCalled()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('lists providers by kind and marks providers that are never cached', async () => {
    const wrapper = await mountPage()

    expect(wrapper.find('[data-testid="cache-provider-book-google"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="cache-provider-book-amazon"]').exists()).toBe(true)
    const audnexus = wrapper.get('[data-testid="cache-provider-author-audnexus"]')
    expect(audnexus.get('[role="switch"]').attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('[data-testid="cache-provider-book-amazon"] input[type="number"]')).toHaveLength(1)
    expect(wrapper.findAll('[data-testid="cache-provider-book-google"] input[type="number"]')).toHaveLength(2)
    wrapper.unmount()
  })

  it('shows usage from the stats endpoint', async () => {
    const wrapper = await mountPage()

    expect(wrapper.get('[data-testid="cache-stat-entries"] dd').text()).toBe('120')
    expect(wrapper.get('[data-testid="cache-stat-hitRate"] dd').text()).toBe('75%')
    expect(wrapper.get('[data-testid="cache-stat-avoided"] dd').text()).toBe('35')
    expect(wrapper.find('table').exists()).toBe(true)
    wrapper.unmount()
  })

  it('keeps Save disabled until a valid change is made', async () => {
    const wrapper = await mountPage()
    const save = () => wrapper.get('[data-testid="metadata-cache-save"]')

    expect(save().attributes('disabled')).toBeDefined()

    await wrapper.get('[data-testid="metadata-cache-storage"]').setValue('10')
    expect(save().attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="metadata-cache-storage"]').attributes('aria-invalid')).toBe('true')

    await wrapper.get('[data-testid="metadata-cache-storage"]').setValue('1024')
    expect(save().attributes('disabled')).toBeUndefined()

    await save().trigger('click')
    await flushPromises()
    const put = mocks.api.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(JSON.parse(String(put?.[1]?.body))).toMatchObject({ maxStorageMb: 1024 })
    wrapper.unmount()
  })

  it('asks before clearing and sends the scoped DELETE once confirmed', async () => {
    const wrapper = await mountPage()

    await wrapper.get('[data-testid="cache-clear-book"]').trigger('click')
    await flushPromises()
    expect(mocks.api.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)

    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    const confirm = [...dialog!.querySelectorAll('button')].at(-1)!
    confirm.click()
    await flushPromises()

    expect(mocks.api).toHaveBeenCalledWith('/api/v1/metadata-cache?namespace=book', { method: 'DELETE' })
    wrapper.unmount()
  })
})
