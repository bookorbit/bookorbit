import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookMetadataFetchConfig, BookMetadataFetchLibraryConfig, Library } from '@bookorbit/types'
import LibraryAutoFetchConfig from './LibraryAutoFetchConfig.vue'

const apiMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>())

vi.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => apiMock(...args),
}))

vi.mock('@vueuse/core', () => ({
  useMediaQuery: () => ref(false),
}))

vi.mock('@/components/ui/ToggleSwitch.vue', () => ({
  default: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<button type="button" data-testid="toggle-switch" @click="$emit(\'update:modelValue\', !modelValue)" />',
  },
}))

vi.mock('./ConditionConfigurator.vue', () => ({
  default: {
    props: ['modelValue', 'disabled'],
    emits: ['update:modelValue'],
    template: '<div data-testid="condition-configurator" :data-disabled="String(disabled)" />',
  },
}))

function response(data: unknown) {
  return {
    ok: true,
    json: async () => data,
  }
}

function makeConfig(threshold: number): BookMetadataFetchConfig {
  return {
    enabled: true,
    triggerOnImport: false,
    conditions: {
      neverFetched: { enabled: false },
      scoreThreshold: { enabled: true, threshold },
      missingFields: { enabled: false, fields: [] },
    },
  }
}

function makeLibraryConfig(): BookMetadataFetchLibraryConfig {
  return {
    ...makeConfig(45),
    override: {
      enabled: true,
      conditions: {
        scoreThreshold: { threshold: 45 },
      },
    },
    lastRunAt: null,
    lastQueuedCount: null,
  }
}

function makeInheritedLibraryConfig(): BookMetadataFetchLibraryConfig {
  return {
    ...makeConfig(70),
    override: null,
    lastRunAt: null,
    lastQueuedCount: null,
  }
}

function makeRunHistoryConfig(lastRunAt: string, lastQueuedCount: number | null): BookMetadataFetchLibraryConfig {
  return {
    ...makeInheritedLibraryConfig(),
    lastRunAt,
    lastQueuedCount,
  }
}

function makeLibrary(): Library {
  return {
    id: 2,
    name: 'PDFs',
    icon: null,
    displayOrder: 0,
    coverAspectRatio: '2/3',
    watch: false,
    autoScanCronExpression: null,
    metadataPrecedence: [],
    formatPriority: [],
    allowedFormats: [],
    organizationMode: 'book_per_file',
    excludePatterns: [],
    readingThreshold: 10,
    markAsFinishedPercentComplete: 90,
    fileNamingPattern: null,
    fileWriteEnabled: false,
    fileWriteWriteCover: false,
    fileWriteEpubEnabled: false,
    fileWriteEpubMaxFileSizeMb: 100,
    fileWriteFb2Enabled: false,
    fileWriteFb2MaxFileSizeMb: 100,
    fileWritePdfEnabled: false,
    fileWritePdfMaxFileSizeMb: 100,
    fileWriteCbxEnabled: false,
    fileWriteCbxMaxFileSizeMb: 500,
    fileWriteKindleEnabled: false,
    fileWriteKindleMaxFileSizeMb: 100,
    fileWriteAudioEnabled: false,
    fileWriteAudioMaxFileSizeMb: 500,
    fileRenameEnabled: false,
    folders: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function mountComponent() {
  return mount(LibraryAutoFetchConfig, {
    props: {
      library: makeLibrary(),
      globalConfig: makeConfig(70),
    },
  })
}

describe('LibraryAutoFetchConfig', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    apiMock.mockReset()
    apiMock.mockImplementation(async (url, init) => {
      const path = String(url)
      if (path === '/api/v1/book-metadata-fetch/config/libraries/2' && !init) return response(makeLibraryConfig())
      if (path === '/api/v1/book-metadata-fetch/preview-count') return response({ count: 8 })
      if (path === '/api/v1/book-metadata-fetch/config/libraries/2' && (init as RequestInit).method === 'PUT') return response(makeLibraryConfig())
      return response({})
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders stored overrides instead of assuming global inheritance', async () => {
    const wrapper = mountComponent()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(401)
    await flushPromises()

    expect(wrapper.text()).not.toContain('Inheriting global defaults')
    expect(wrapper.text()).toContain('Score < 45')
    expect(wrapper.text()).toContain('Save override')

    const previewCall = apiMock.mock.calls.find(([url]) => String(url) === '/api/v1/book-metadata-fetch/preview-count')
    expect(previewCall).toBeDefined()
    const [, init] = previewCall as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      libraryId: 2,
      conditions: {
        scoreThreshold: { threshold: 45 },
      },
    })
  })

  it('saves only config fields for a library override', async () => {
    const wrapper = mountComponent()
    await flushPromises()

    const saveButton = wrapper.findAll('button').find((button) => button.text().includes('Save override'))
    expect(saveButton).toBeDefined()
    await saveButton!.trigger('click')
    await flushPromises()

    const putCall = apiMock.mock.calls.find(
      ([url, init]) => String(url) === '/api/v1/book-metadata-fetch/config/libraries/2' && (init as RequestInit)?.method === 'PUT',
    )
    expect(putCall).toBeDefined()
    const [, init] = putCall as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual(makeConfig(45))
  })

  it('persists null override when switching back to global inheritance', async () => {
    apiMock.mockImplementation(async (url, init) => {
      const path = String(url)
      if (path === '/api/v1/book-metadata-fetch/config/libraries/2' && !init) return response(makeLibraryConfig())
      if (path === '/api/v1/book-metadata-fetch/preview-count') return response({ count: 8 })
      if (path === '/api/v1/book-metadata-fetch/config/libraries/2' && (init as RequestInit).method === 'PUT')
        return response(makeInheritedLibraryConfig())
      return response({})
    })
    const wrapper = mountComponent()
    await flushPromises()

    await wrapper.get('[data-testid="toggle-switch"]').trigger('click')
    await flushPromises()

    const putCall = apiMock.mock.calls.find(
      ([url, init]) => String(url) === '/api/v1/book-metadata-fetch/config/libraries/2' && (init as RequestInit)?.method === 'PUT',
    )
    expect(putCall).toBeDefined()
    const [, init] = putCall as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({})
    expect(wrapper.text()).toContain('Inheriting global defaults')
    expect(wrapper.text()).not.toContain('Save override')
  })

  it('records a zero-queued manual run in the library card', async () => {
    apiMock.mockImplementation(async (url, init) => {
      const path = String(url)
      if (path === '/api/v1/book-metadata-fetch/config/libraries/2' && !init) return response(makeInheritedLibraryConfig())
      if (path === '/api/v1/book-metadata-fetch/preview-count') return response({ count: 8 })
      if (path === '/api/v1/book-metadata-fetch/run/2' && (init as RequestInit).method === 'POST') return response({ queued: 0 })
      return response({})
    })
    const wrapper = mountComponent()
    await flushPromises()

    const runButton = wrapper.findAll('button').find((button) => button.text().includes('Run now'))
    expect(runButton).toBeDefined()
    await runButton!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('No eligible books found')
    expect(wrapper.text()).toContain('Last run: just now - no eligible books')
  })

  it('records a queued manual run in the library card', async () => {
    apiMock.mockImplementation(async (url, init) => {
      const path = String(url)
      if (path === '/api/v1/book-metadata-fetch/config/libraries/2' && !init) return response(makeInheritedLibraryConfig())
      if (path === '/api/v1/book-metadata-fetch/preview-count') return response({ count: 8 })
      if (path === '/api/v1/book-metadata-fetch/run/2' && (init as RequestInit).method === 'POST') return response({ queued: 5 })
      return response({})
    })
    const wrapper = mountComponent()
    await flushPromises()

    const runButton = wrapper.findAll('button').find((button) => button.text().includes('Run now'))
    expect(runButton).toBeDefined()
    await runButton!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Queued 5 books')
    expect(wrapper.text()).toContain('Last run: just now - queued 5 books')
  })

  it('allows an inherited library to start a local override without saving immediately', async () => {
    apiMock.mockImplementation(async (url, init) => {
      const path = String(url)
      if (path === '/api/v1/book-metadata-fetch/config/libraries/2' && !init) return response(makeInheritedLibraryConfig())
      if (path === '/api/v1/book-metadata-fetch/preview-count') return response({ count: 8 })
      return response({})
    })
    const wrapper = mountComponent()
    await flushPromises()

    await wrapper.setProps({ globalConfig: makeConfig(80) })
    await flushPromises()
    await wrapper.get('[data-testid="toggle-switch"]').trigger('click')
    await flushPromises()

    const putCall = apiMock.mock.calls.find(
      ([url, init]) => String(url) === '/api/v1/book-metadata-fetch/config/libraries/2' && (init as RequestInit)?.method === 'PUT',
    )
    expect(putCall).toBeUndefined()
    expect(wrapper.text()).toContain('Score < 80')
    expect(wrapper.text()).toContain('Save override')
  })

  it('collapses the card and condition editor without losing state', async () => {
    const wrapper = mountComponent()
    await flushPromises()

    expect(wrapper.find('[data-testid="condition-configurator"]').exists()).toBe(true)

    const conditionButton = wrapper.findAll('button').find((button) => button.text().includes('Eligibility conditions'))
    expect(conditionButton).toBeDefined()
    await conditionButton!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="condition-configurator"]').exists()).toBe(false)

    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('Run now')

    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Score < 45')
  })

  it('summarizes missing-field and disabled override conditions', async () => {
    const disabledConfig = makeLibraryConfig()
    disabledConfig.enabled = false
    disabledConfig.conditions.neverFetched.enabled = true
    disabledConfig.conditions.missingFields = { enabled: true, fields: ['cover'] }
    disabledConfig.override = {
      enabled: false,
      conditions: {
        neverFetched: { enabled: true },
        missingFields: { enabled: true, fields: ['cover'] },
      },
    }
    apiMock.mockImplementation(async (url, init) => {
      const path = String(url)
      if (path === '/api/v1/book-metadata-fetch/config/libraries/2' && !init) return response(disabledConfig)
      if (path === '/api/v1/book-metadata-fetch/preview-count') return response({ count: 8 })
      return response({})
    })

    const wrapper = mountComponent()
    await flushPromises()

    expect(wrapper.text()).toContain('Never fetched')
    expect(wrapper.text()).toContain('Score < 45')
    expect(wrapper.text()).toContain('Missing 1 field')
    expect(wrapper.get('[data-testid="condition-configurator"]').attributes('data-disabled')).toBe('true')
  })

  it('summarizes empty and plural missing-field override conditions', async () => {
    const config = makeLibraryConfig()
    config.conditions = {
      neverFetched: { enabled: false },
      scoreThreshold: { enabled: false, threshold: 45 },
      missingFields: { enabled: false, fields: ['cover', 'description'] },
    }
    apiMock.mockImplementation(async (url, init) => {
      const path = String(url)
      if (path === '/api/v1/book-metadata-fetch/config/libraries/2' && !init) return response(config)
      if (path === '/api/v1/book-metadata-fetch/preview-count') return response({ count: 8 })
      return response({})
    })

    const wrapper = mountComponent()
    await flushPromises()
    expect(wrapper.text()).toContain('No conditions enabled')

    config.conditions.missingFields.enabled = true
    wrapper.unmount()
    const wrapper2 = mountComponent()
    await flushPromises()
    expect(wrapper2.text()).toContain('Missing 2 fields')
  })

  it.each([
    ['2026-01-10T11:50:00.000Z', null, 'Last run: 10m ago'],
    ['2026-01-10T09:00:00.000Z', null, 'Last run: 3h ago'],
    ['2026-01-09T12:00:00.000Z', null, 'Last run: yesterday'],
    ['2026-01-06T12:00:00.000Z', null, 'Last run: 4 days ago'],
  ])('formats previous run time %s', async (lastRunAt, lastQueuedCount, expected) => {
    vi.setSystemTime(new Date('2026-01-10T12:00:00.000Z'))
    apiMock.mockImplementation(async (url, init) => {
      const path = String(url)
      if (path === '/api/v1/book-metadata-fetch/config/libraries/2' && !init) return response(makeRunHistoryConfig(lastRunAt, lastQueuedCount))
      if (path === '/api/v1/book-metadata-fetch/preview-count') return response({ count: 8 })
      return response({})
    })

    const wrapper = mountComponent()
    await flushPromises()

    expect(wrapper.text()).toContain(expected)
  })
})
