import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { ScrollStrategy } from '@embedpdf/plugin-scroll'
import { SpreadMode } from '@embedpdf/plugin-spread'
import { ZoomMode } from '@embedpdf/plugin-zoom'
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
vi.mock('../../shared/composables/useReadingSession', () => ({
  useReadingSession: () => ({
    onActivity: mockOnActivity,
    elapsedMinutes: ref(0),
  }),
}))

const mockUsePdfiumEngine = vi.fn<() => unknown>(() => ({
  engine: ref({ id: 'engine' }),
  isLoading: ref(false),
  error: ref(null),
}))
vi.mock('@embedpdf/engines/vue', () => ({
  usePdfiumEngine: mockUsePdfiumEngine,
}))

const mockCreatePluginRegistration = vi.fn<(pluginPackage: unknown, config?: unknown) => { pluginPackage: unknown; config?: unknown }>(
  (pluginPackage, config) => ({ pluginPackage, config }),
)
const mockOpenDocumentBuffer = vi.hoisted(() => vi.fn<(options: unknown) => unknown>())
const mockCloseDocument = vi.hoisted(() => vi.fn<(documentId: string) => unknown>())
const mockGetDocumentState = vi.hoisted(() => vi.fn<(documentId: string) => unknown>())
const mockDocumentManager = {
  openDocumentBuffer: mockOpenDocumentBuffer,
  closeDocument: mockCloseDocument,
  getDocumentState: mockGetDocumentState,
}
const mockRegistry = {
  pluginsReady: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  isDestroyed: vi.fn<() => boolean>().mockReturnValue(false),
  getPlugin: vi.fn<() => { provides: () => typeof mockDocumentManager }>(() => ({ provides: () => mockDocumentManager })),
}
vi.mock('@embedpdf/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@embedpdf/core')>()
  return { ...original, createPluginRegistration: mockCreatePluginRegistration }
})

vi.mock('@embedpdf/core/vue', () => ({
  EmbedPDF: defineComponent({
    props: ['engine', 'plugins', 'onInitialized'],
    setup(props, { slots }) {
      void props.onInitialized?.(mockRegistry)
      return () =>
        h(
          'div',
          { class: 'mock-embed-pdf' },
          slots.default?.({ pluginsReady: true, activeDocumentId: 'document-1', activeDocument: { status: 'loaded' } }),
        )
    },
  }),
}))

const { default: PdfV4ReaderView } = await import('../PdfV4ReaderView.vue')

describe('PdfV4ReaderView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSettingsLoad.mockResolvedValue(undefined)
    mockApi.mockReset()
    mockApi.mockImplementation(async () => new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 }))
    mockOpenDocumentBuffer.mockReset()
    mockOpenDocumentBuffer.mockImplementation(() => ({
      toPromise: async () => ({
        documentId: 'document-1',
        task: { toPromise: async () => ({ pageCount: 12 }) },
      }),
    }))
    mockCloseDocument.mockReset()
    mockCloseDocument.mockImplementation(() => ({ toPromise: async () => undefined }))
    mockGetDocumentState.mockReset()
    mockRegistry.pluginsReady.mockResolvedValue(undefined)
    mockRegistry.isDestroyed.mockReturnValue(false)
    mockRegistry.getPlugin.mockReturnValue({ provides: () => mockDocumentManager })
    mockRoute.query = {}
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
            props: ['documentId', 'initialPage', 'settings', 'peekMode'],
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

  it('opens the verified document buffer after every plugin is initialized', async () => {
    await mountReader()

    const documentConfig = mockCreatePluginRegistration.mock.calls[0]?.[1] as {
      maxDocuments: number
    }
    expect(documentConfig.maxDocuments).toBe(1)
    expect(documentConfig).not.toHaveProperty('initialDocuments')
    expect(mockRegistry.pluginsReady).toHaveBeenCalledOnce()
    expect(mockOpenDocumentBuffer).toHaveBeenCalledWith({
      name: 'PDF',
      buffer: expect.any(ArrayBuffer),
      rotation: 0,
    })
    expect(mockApi).toHaveBeenCalledWith('/api/v1/books/files/101/serve', { signal: expect.any(AbortSignal) })
  })

  it('retries a zero-page engine result once before showing an error', async () => {
    mockOpenDocumentBuffer.mockImplementation(() => ({
      toPromise: async () => ({
        documentId: 'document-zero',
        task: { toPromise: async () => ({ pageCount: 0 }) },
      }),
    }))

    const wrapper = await mountReader()

    expect(mockOpenDocumentBuffer).toHaveBeenCalledTimes(2)
    expect(mockCloseDocument).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('The PDF engine opened this document without any pages.')
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
    expect(wrapper.find('.mock-embed-pdf').exists()).toBe(false)
  })

  it('refetches the PDF when document content requests recovery', async () => {
    const wrapper = await mountReader()
    mockApi.mockClear()

    wrapper.getComponent({ name: 'PdfReaderContent' }).vm.$emit('retry')
    await flushPromises()

    expect(mockApi).toHaveBeenCalledOnce()
    expect(wrapper.find('.mock-reader-content').exists()).toBe(true)
  })

  it('runs PDFium in a worker with an absolute WASM URL', async () => {
    await mountReader()

    expect(mockUsePdfiumEngine).toHaveBeenCalledWith({
      wasmUrl: expect.stringMatching(/^https?:\/\//),
      worker: true,
    })
  })

  it('shows a recoverable error when reader state fails to load', async () => {
    mockSettingsLoad.mockRejectedValueOnce(new Error('Settings unavailable'))

    const wrapper = await mountReader()

    expect(wrapper.text()).toContain('Unable to open this PDF')
    expect(wrapper.text()).toContain('Settings unavailable')
    expect(wrapper.text()).toContain('Retry')
    expect(wrapper.find('.mock-embed-pdf').exists()).toBe(false)
  })

  it('maps persisted layout settings into headless plugin configuration', async () => {
    mockEffective.value = {
      scrollMode: 'horizontal',
      spread: 'odd',
      zoomMode: 'fit-width',
      customScale: 1.5,
      rotation: 0,
    }
    await mountReader()

    expect(mockCreatePluginRegistration.mock.calls[2]?.[1]).toMatchObject({ defaultStrategy: ScrollStrategy.Horizontal })
    expect(mockCreatePluginRegistration.mock.calls[4]?.[1]).toMatchObject({ defaultZoomLevel: ZoomMode.FitWidth })
    expect(mockCreatePluginRegistration.mock.calls[6]?.[1]).toMatchObject({ defaultSpreadMode: SpreadMode.Odd })
  })

  it('uses a deep-linked page before saved progress', async () => {
    mockRoute.query = { page: '12' }
    const wrapper = await mountReader()

    expect(wrapper.getComponent({ name: 'PdfReaderContent' }).props('initialPage')).toBe(12)
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
