import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookMetadataFetchBreakdown, BookMetadataFetchConfig, BookMetadataFetchLibraryConfigEntry } from '@bookorbit/types'
import BookMetadataFetchSettings from '../BookMetadataFetchSettings.vue'

const apiMock = vi.hoisted(() => vi.fn<(path: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>())
const toastMock = vi.hoisted(() => ({ success: vi.fn<(message: string) => void>(), error: vi.fn<(message: string) => void>() }))

vi.mock('@/lib/api', () => ({ api: (path: string, init?: RequestInit) => apiMock(path, init) }))
vi.mock('vue-sonner', () => ({ toast: toastMock }))
vi.mock('@vueuse/core', () => ({ useMediaQuery: () => ref(false) }))
vi.mock('../components/AutoFetchQueueBand.vue', () => ({ default: { template: '<div data-testid="queue-band" />' } }))
vi.mock('../components/AutoFetchPreviewList.vue', () => ({
  default: {
    props: ['items', 'matching', 'total', 'conditions', 'libraryNames'],
    template: '<div data-testid="preview" :data-matching="matching" />',
  },
}))

const global: BookMetadataFetchConfig = {
  enabled: false,
  triggerOnImport: false,
  conditions: {
    neverFetched: { enabled: true },
    scoreThreshold: { enabled: true, threshold: 60 },
    missingFields: { enabled: true, fields: ['description', 'cover'] },
  },
}

function entry(
  libraryId: number,
  libraryName: string,
  override: BookMetadataFetchLibraryConfigEntry['override'] = null,
): BookMetadataFetchLibraryConfigEntry {
  return { libraryId, libraryName, ...global, override, lastRunAt: null, lastQueuedCount: null }
}

const breakdown: BookMetadataFetchBreakdown = {
  total: 480,
  matching: 456,
  neverFetched: 456,
  lowScore: 5,
  missingAny: 27,
  missingByField: {
    title: 0,
    subtitle: 292,
    description: 27,
    cover: 0,
    audioCover: 0,
    authors: 1,
    publisher: 20,
    isbn: 136,
    publishedYear: 24,
    language: 9,
    pageCount: 189,
    communityRating: 236,
    seriesName: 351,
    seriesIndex: 359,
    genres: 113,
    narrators: 3,
    duration: 3,
    abridged: 0,
  },
  withAudio: 16,
  scoreBins: Array.from({ length: 20 }, (_, i) => (i > 12 ? 30 : 1)),
  unscored: 0,
}

function ok(data: unknown) {
  return { ok: true, json: async () => data }
}

let libraries: BookMetadataFetchLibraryConfigEntry[]

function lastCall(path: string, method: string) {
  const calls = apiMock.mock.calls.filter(([p, init]) => p === path && (init?.method ?? 'GET') === method)
  return calls[calls.length - 1]
}

async function mountPage() {
  const wrapper = mount(BookMetadataFetchSettings, { global: { stubs: { RouterLink: true } } })
  await flushPromises()
  await vi.advanceTimersByTimeAsync(300)
  await flushPromises()
  return wrapper
}

function tab(wrapper: Awaited<ReturnType<typeof mountPage>>, name: string) {
  return wrapper.findAll('[role="tab"]').find((item) => item.text().startsWith(name))!
}

describe('BookMetadataFetchSettings', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    apiMock.mockReset()
    toastMock.success.mockReset()
    toastMock.error.mockReset()
    libraries = [entry(2, 'Audiobooks'), entry(6, 'Comics', { conditions: { scoreThreshold: { enabled: true, threshold: 75 } } })]
    apiMock.mockImplementation(async (path, init) => {
      const method = init?.method ?? 'GET'
      if (path === '/api/v1/book-metadata-fetch/config' && method === 'GET') return ok(global)
      if (path === '/api/v1/book-metadata-fetch/config' && method === 'PUT') return ok(JSON.parse(String(init!.body)))
      if (path === '/api/v1/book-metadata-fetch/config/libraries') return ok(libraries)
      if (path.startsWith('/api/v1/book-metadata-fetch/config/libraries/') && method === 'PUT') {
        const body = JSON.parse(String(init!.body))
        return ok({ ...global, override: Object.keys(body).length ? body : null, lastRunAt: null, lastQueuedCount: null })
      }
      if (path === '/api/v1/book-metadata-fetch/preview-breakdown') return ok(breakdown)
      if (path === '/api/v1/book-metadata-fetch/preview-books') return ok({ items: [], total: 456 })
      if (path.startsWith('/api/v1/book-metadata-fetch/run')) return ok({ queued: 4 })
      return ok({})
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens on the global rule with a tab per library and counts for the libraries that follow it', async () => {
    const wrapper = await mountPage()

    expect(wrapper.findAll('[role="tab"]').map((item) => item.text())).toEqual(['Global defaults', 'Audiobooks', 'Comics1'])
    expect(wrapper.text()).toContain('Applies to 1 library, 480 books.')
    expect(wrapper.text()).toContain('Comics has its own rule.')
    const scope = JSON.parse(String(lastCall('/api/v1/book-metadata-fetch/preview-breakdown', 'POST')![1]!.body))
    expect(scope).toEqual({ conditions: global.conditions, libraryIds: [2] })
    expect(wrapper.text()).toContain('456')
  })

  it('writes both import flags from the one switch', async () => {
    const wrapper = await mountPage()

    await wrapper.get('[aria-labelledby="auto-fetch-import-label"]').trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Save Global defaults')!
      .trigger('click')
    await flushPromises()

    const body = JSON.parse(String(lastCall('/api/v1/book-metadata-fetch/config', 'PUT')![1]!.body))
    expect(body).toMatchObject({ enabled: true, triggerOnImport: true })
    expect(toastMock.success).toHaveBeenCalledWith('Saved Global defaults')
  })

  it('saves only what a library changes, and marks each condition as its own or the global one', async () => {
    const wrapper = await mountPage()
    await tab(wrapper, 'Audiobooks').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Audiobooks follows the global rule.')
    expect(wrapper.findAll('section[data-condition] h3 + span').map((item) => item.text())).toEqual(['Global', 'Global', 'Global'])

    await wrapper.get('[data-condition="scoreThreshold"] button[aria-label="Raise the threshold"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-condition="scoreThreshold"] h3 + span').text()).toContain('Own')
    expect(wrapper.text()).toContain('Global rule: Score below 60')
    expect(wrapper.get('[data-testid="auto-fetch-run"]').attributes('disabled')).toBeDefined()

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Save Audiobooks')!
      .trigger('click')
    await flushPromises()

    const body = JSON.parse(String(lastCall('/api/v1/book-metadata-fetch/config/libraries/2', 'PUT')![1]!.body))
    expect(body).toEqual({ conditions: { scoreThreshold: { enabled: true, threshold: 65 } } })
    expect(tab(wrapper, 'Audiobooks').text()).toBe('Audiobooks1')
  })

  it('keeps turning a library back to the global rule a draft until it is saved', async () => {
    const wrapper = await mountPage()
    await tab(wrapper, 'Comics').trigger('click')
    await flushPromises()

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Use the global rule')!
      .trigger('click')
    await flushPromises()
    expect(lastCall('/api/v1/book-metadata-fetch/config/libraries/6', 'PUT')).toBeUndefined()
    expect(wrapper.text()).toContain('1 unsaved change in Comics')

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Discard')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Comics has its own rule for 1 setting.')

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Use the global rule')!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Save Comics')!
      .trigger('click')
    await flushPromises()
    expect(JSON.parse(String(lastCall('/api/v1/book-metadata-fetch/config/libraries/6', 'PUT')![1]!.body))).toEqual({})
  })

  it('runs every library from the global tab and the one library from its tab, passing ignore-cache only when asked', async () => {
    const wrapper = await mountPage()

    await wrapper.get('[data-testid="auto-fetch-run"]').trigger('click')
    await flushPromises()
    expect(lastCall('/api/v1/book-metadata-fetch/run', 'POST')![1]).toEqual({ method: 'POST' })
    expect(toastMock.success).toHaveBeenCalledWith('Queued 4 books')

    await tab(wrapper, 'Comics').trigger('click')
    await wrapper.get('[data-testid="ignore-cache-checkbox"]').setValue(true)
    await wrapper.get('[data-testid="auto-fetch-run"]').trigger('click')
    await flushPromises()
    expect(JSON.parse(String(lastCall('/api/v1/book-metadata-fetch/run/6', 'POST')![1]!.body))).toEqual({ ignoreCache: true })
    expect((wrapper.get('[data-testid="ignore-cache-checkbox"]').element as HTMLInputElement).checked).toBe(false)
  })

  it('shows an error instead of an empty form when the settings cannot load', async () => {
    apiMock.mockImplementation(async () => ({ ok: false, json: async () => ({}) }))
    const wrapper = await mountPage()

    expect(wrapper.get('[role="alert"]').text()).toContain('could not be loaded')
  })
})
