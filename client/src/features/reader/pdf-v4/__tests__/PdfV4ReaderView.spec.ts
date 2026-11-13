import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { onUnmounted, ref } from 'vue'
import type { PdfReaderSettings } from '@bookorbit/types'

const mockRouterBack = vi.fn<() => void>()
const mockRouterReplace = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
const mockRoute = {
  params: { bookId: '42', fileId: '101' },
  query: {} as Record<string, string>,
}

vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
  useRouter: () => ({ back: mockRouterBack, replace: mockRouterReplace }),
}))

const mockApi = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>())
vi.mock('@/lib/api', () => ({ api: mockApi }))

const mockSettingsLoad = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
const mockUpdateBookSettings = vi.fn<(patch: Partial<PdfReaderSettings>) => void>()
const mockEffective = ref<PdfReaderSettings>({
  scrollMode: 'page' as const,
  spread: 'none' as const,
  zoomMode: 'fit-page' as const,
  customScale: 1,
  rotation: 0,
})

vi.mock('../../shared/composables/useReaderSettings', () => ({
  useReaderSettings: () => ({
    load: mockSettingsLoad,
    effective: mockEffective,
    updateBookSettings: mockUpdateBookSettings,
  }),
}))

const mockProgressLoad = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
const mockProgressSave = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
const mockProgressPageNumber = ref<number | null>(5)
const mockProgressPercentage = ref(25)

vi.mock('../../shared/composables/useReaderProgress', () => ({
  useReaderProgress: () => ({
    load: mockProgressLoad,
    save: mockProgressSave,
    pageNumber: mockProgressPageNumber,
    percentage: mockProgressPercentage,
  }),
}))

const mockOnActivity = vi.fn<() => void>()
type SessionSnapshot = { percentage: number; pageNumber?: number | null }
const sessionEndSnapshots: SessionSnapshot[] = []
// Like the real composable, the session ends from an unmounted hook registered before the view's own.
vi.mock('../../shared/composables/useReadingSession', () => ({
  useReadingSession: (_fileId: number, getProgress: () => SessionSnapshot) => {
    onUnmounted(() => sessionEndSnapshots.push(getProgress()))
    return {
      onActivity: mockOnActivity,
      elapsedMinutes: ref(0),
    }
  },
}))

const mockCreatePdfEngine = vi.hoisted(() => vi.fn<() => unknown>())
vi.mock('../pdf-engine', () => ({ createPdfEngine: mockCreatePdfEngine }))

const mockStagePlugin = vi.hoisted(() => vi.fn<(options: Record<string, unknown>) => unknown>((options) => ({ id: 'stage', options })))
vi.mock('@embedpdf/vue/stage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@embedpdf/vue/stage')>()),
  stagePlugin: mockStagePlugin,
}))

const viewer = vi.hoisted(() => ({ mounts: 0, startError: null as Error | null }))
vi.mock('@embedpdf/vue/runtime', async (importOriginal) => {
  const { defineComponent: define, h: create } = await import('vue')
  return {
    ...(await importOriginal<typeof import('@embedpdf/vue/runtime')>()),
    Viewer: define({
      name: 'Viewer',
      props: ['engine', 'plugins', 'initialDocuments'],
      setup(_, { slots }) {
        viewer.mounts += 1
        return () => create('div', { class: 'mock-viewer' }, viewer.startError ? slots.error?.({ error: viewer.startError }) : slots.default?.())
      },
    }),
  }
})

const { default: PdfV4ReaderView } = await import('../PdfV4ReaderView.vue')

describe('PdfV4ReaderView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSettingsLoad.mockResolvedValue(undefined)
    mockApi.mockReset()
    mockApi.mockImplementation(async () => new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 }))
    viewer.mounts = 0
    viewer.startError = null
    mockRoute.query = {}
    sessionEndSnapshots.length = 0
    mockProgressPageNumber.value = 5
    mockProgressPercentage.value = 25
    mockEffective.value = {
      scrollMode: 'page',
      spread: 'none',
      zoomMode: 'fit-page',
      customScale: 1,
      rotation: 0,
    }
  })

  async function mountReader(peekMode = false) {
    const wrapper = mount(PdfV4ReaderView, {
      props: { bookId: 42, fileId: 101, peekMode },
      global: {
        stubs: {
          PdfReaderContent: {
            name: 'PdfReaderContent',
            props: ['bookId', 'fileId', 'initialPage', 'initialPercentage', 'settings', 'peekMode'],
            emits: ['back', 'pageChange', 'retry', 'settingsChange', 'startReading'],
            template: '<div class="mock-reader-content" />',
          },
        },
      },
    })
    await flushPromises()
    return wrapper
  }

  it('loads settings and progress before rendering document content', async () => {
    const wrapper = await mountReader()

    expect(mockSettingsLoad).toHaveBeenCalledOnce()
    expect(mockProgressLoad).toHaveBeenCalledOnce()
    expect(wrapper.find('.mock-reader-content').exists()).toBe(true)
  })

  it('hands the fetched file to a viewer that owns its engine', async () => {
    const wrapper = await mountReader()

    const viewerProps = wrapper.getComponent({ name: 'Viewer' }).props()
    expect(viewerProps.engine).toBe(mockCreatePdfEngine)
    expect(viewerProps.initialDocuments).toEqual([{ source: { kind: 'bytes', bytes: new Uint8Array([37, 80, 68, 70]) }, name: 'PDF' }])
    expect(mockApi).toHaveBeenCalledWith('/api/v1/books/files/101/serve', { signal: expect.any(AbortSignal) })
  })

  it('shows a recoverable error when the PDF response is unsuccessful', async () => {
    mockApi.mockResolvedValueOnce(new Response(null, { status: 503 }))

    const wrapper = await mountReader()

    expect(wrapper.text()).toContain('The PDF request failed with status 503.')
    expect(wrapper.text()).toContain('Retry')
  })

  it('rejects an empty PDF response instead of mounting a zero-page document', async () => {
    mockApi.mockResolvedValueOnce(new Response(null, { status: 200 }))

    const wrapper = await mountReader()

    expect(wrapper.text()).toContain('The PDF request returned an empty document.')
    expect(wrapper.find('.mock-viewer').exists()).toBe(false)
  })

  it('refetches the PDF into a new viewer when document content requests recovery', async () => {
    const wrapper = await mountReader()
    mockApi.mockClear()

    wrapper.getComponent({ name: 'PdfReaderContent' }).vm.$emit('retry')
    await flushPromises()

    expect(mockApi).toHaveBeenCalledOnce()
    expect(viewer.mounts).toBe(2)
    expect(wrapper.find('.mock-reader-content').exists()).toBe(true)
  })

  it('offers a retry when the viewer cannot start its engine', async () => {
    viewer.startError = new Error('WebAssembly unavailable')
    const wrapper = await mountReader()

    expect(wrapper.text()).toContain('WebAssembly unavailable')
    mockApi.mockClear()
    viewer.startError = null

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Retry')!
      .trigger('click')
    await flushPromises()

    expect(mockApi).toHaveBeenCalledOnce()
    expect(wrapper.find('.mock-reader-content').exists()).toBe(true)
  })

  it('shows a recoverable error when reader state fails to load', async () => {
    mockSettingsLoad.mockRejectedValueOnce(new Error('Settings unavailable'))

    const wrapper = await mountReader()

    expect(wrapper.text()).toContain('Unable to open this PDF')
    expect(wrapper.text()).toContain('Settings unavailable')
    expect(wrapper.text()).toContain('Retry')
    expect(wrapper.find('.mock-viewer').exists()).toBe(false)
  })

  it('maps persisted layout settings into the Stage configuration', async () => {
    mockEffective.value = {
      scrollMode: 'horizontal',
      spread: 'odd',
      zoomMode: 'fit-width',
      customScale: 1.5,
      rotation: 90,
    }
    await mountReader()

    expect(mockStagePlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        flow: 'continuous',
        layout: 'horizontal',
        spread: 'odd',
        zoom: { mode: 'fit-width' },
        viewRotation: 90,
        viewUnitsPerPoint: 1,
      }),
    )
  })

  it('opens at a saved custom zoom and lets a responsive rule drive the automatic spread', async () => {
    mockEffective.value = {
      scrollMode: 'page',
      spread: 'auto',
      zoomMode: 'custom',
      customScale: 1.5,
      rotation: 0,
    }
    await mountReader()

    const options = mockStagePlugin.mock.calls[0]?.[0] as { flow: string; spread: string; zoom: unknown; responsive: { name?: string }[] }
    expect(options.flow).toBe('paged')
    expect(options.spread).toBe('none')
    expect(options.zoom).toEqual({ level: 1.5 })
    expect(options.responsive.map((rule) => rule.name)).toEqual(['compact', 'auto-spread'])
  })

  it('uses a deep-linked page before saved progress', async () => {
    mockRoute.query = { page: '12' }
    const wrapper = await mountReader()

    expect(wrapper.getComponent({ name: 'PdfReaderContent' }).props('initialPage')).toBe(12)
  })

  it('opens at a saved page number before its percentage', async () => {
    const wrapper = await mountReader()

    expect(wrapper.getComponent({ name: 'PdfReaderContent' }).props('initialPage')).toBe(5)
  })

  it('passes a percentage-only position through for the page estimate', async () => {
    mockProgressPageNumber.value = null
    mockProgressPercentage.value = 37.5
    const wrapper = await mountReader()

    const content = wrapper.getComponent({ name: 'PdfReaderContent' })
    expect(content.props('initialPage')).toBeNull()
    expect(content.props('initialPercentage')).toBe(37.5)
  })

  it('treats a zero page number as no page so the percentage still places the reader', async () => {
    mockProgressPageNumber.value = 0
    mockProgressPercentage.value = 60
    const wrapper = await mountReader()

    expect(wrapper.getComponent({ name: 'PdfReaderContent' }).props('initialPage')).toBeNull()
  })

  it('does not write progress for the page the reader opened on', async () => {
    vi.useFakeTimers()
    mockProgressPageNumber.value = null
    mockProgressPercentage.value = 37.5
    const wrapper = await mountReader()
    wrapper.getComponent({ name: 'PdfReaderContent' }).vm.$emit('pageChange', 4, 10, true)
    await vi.advanceTimersByTimeAsync(2000)
    wrapper.unmount()

    expect(mockProgressSave).not.toHaveBeenCalled()
    expect(mockProgressPageNumber.value).toBe(4)
    expect(mockProgressPercentage.value).toBe(40)
    vi.useRealTimers()
  })

  it('flushes a debounced page turn before the reading session ends', async () => {
    vi.useFakeTimers()
    const wrapper = await mountReader()
    wrapper.getComponent({ name: 'PdfReaderContent' }).vm.$emit('pageChange', 8, 20)
    await vi.advanceTimersByTimeAsync(500)
    wrapper.unmount()

    expect(sessionEndSnapshots).toEqual([{ percentage: 40, pageNumber: 8 }])
    expect(mockProgressSave).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('debounces page progress saves', async () => {
    vi.useFakeTimers()
    const wrapper = await mountReader()
    wrapper.getComponent({ name: 'PdfReaderContent' }).vm.$emit('pageChange', 8, 20)
    await vi.advanceTimersByTimeAsync(2000)

    expect(mockProgressPageNumber.value).toBe(8)
    expect(mockProgressPercentage.value).toBe(40)
    expect(mockProgressSave).toHaveBeenCalledOnce()
    expect(mockOnActivity).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('keeps peek mode out of tracked progress and starts reading on request', async () => {
    const wrapper = await mountReader(true)
    wrapper.getComponent({ name: 'PdfReaderContent' }).vm.$emit('startReading')
    await flushPromises()

    expect(mockRouterReplace).toHaveBeenCalledWith({ name: 'reader', params: mockRoute.params, query: {} })
    expect(mockProgressSave).toHaveBeenCalledOnce()
    expect(mockOnActivity).toHaveBeenCalledOnce()
  })

  it('routes back from the BookOrbit reader shell', async () => {
    const wrapper = await mountReader()
    wrapper.getComponent({ name: 'PdfReaderContent' }).vm.$emit('back')
    expect(mockRouterBack).toHaveBeenCalledOnce()
  })
})
