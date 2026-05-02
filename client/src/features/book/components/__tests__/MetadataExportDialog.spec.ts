import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import MetadataExportDialog from '../MetadataExportDialog.vue'

const composableMocks = vi.hoisted(() => ({
  preflight: vi.fn<(request: unknown) => Promise<unknown>>(),
  download: vi.fn<(request: unknown) => Promise<unknown>>(),
}))

const toastMocks = vi.hoisted(() => ({
  success: vi.fn<(message: string) => void>(),
  error: vi.fn<(message: string) => void>(),
}))

vi.mock('@/features/book/composables/useBookMetadataExport', async () => {
  const { ref } = await import('vue')
  return {
    useBookMetadataExport: () => ({
      loading: ref(false),
      preflight: composableMocks.preflight,
      download: composableMocks.download,
    }),
  }
})

vi.mock('vue-sonner', () => ({
  toast: {
    success: toastMocks.success,
    error: toastMocks.error,
  },
}))

const PREVIEW = {
  schemaVersion: 1,
  rowCount: 20,
  estimatedBytes: 1024,
  sizeCategory: 'small',
  fileName: 'bookorbit-library-all-matching-2026-05-07.csv',
  scope: 'all-matching',
  format: 'csv',
} as const

type ExportRequest = {
  scope: string
  format: string
  options: {
    includePersonalData: boolean
    includeFilePaths: boolean
    includeContextMeta: boolean
    columnsMode: string
  }
}

function mountDialog(props: Record<string, unknown>) {
  return mount(MetadataExportDialog, {
    props: {
      open: false,
      viewType: 'library',
      selectedBookIds: [1, 2],
      selectedCount: 2,
      totalCount: 20,
      allMatchingQuery: { libraryId: 4, q: 'dune' },
      visibleColumns: ['title', 'authors'],
      ...props,
    },
    global: {
      stubs: {
        Teleport: true,
      },
    },
  })
}

describe('MetadataExportDialog', () => {
  beforeEach(() => {
    localStorage.clear()
    composableMocks.preflight.mockReset()
    composableMocks.download.mockReset()
    toastMocks.success.mockReset()
    toastMocks.error.mockReset()
    composableMocks.preflight.mockResolvedValue(PREVIEW)
    composableMocks.download.mockResolvedValue(PREVIEW)
  })

  it('defaults to all-matching scope when query payload exists and requests preflight', async () => {
    const wrapper = mountDialog({})
    await wrapper.setProps({ open: true })
    await flushPromises()

    expect(composableMocks.preflight).toHaveBeenCalled()
    const request = composableMocks.preflight.mock.calls[0]?.[0] as { scope: string }
    expect(request.scope).toBe('all-matching')
  })

  it('falls back to selected scope when all-matching query is unavailable', async () => {
    const wrapper = mountDialog({ allMatchingQuery: undefined, defaultScope: 'all-matching' })
    await wrapper.setProps({ open: true })
    await flushPromises()

    expect(composableMocks.preflight).toHaveBeenCalled()
    const request = composableMocks.preflight.mock.calls[0]?.[0] as { scope: string }
    expect(request.scope).toBe('selected')
  })

  it('downloads metadata export and closes on success', async () => {
    const wrapper = mountDialog({})
    await wrapper.setProps({ open: true })
    await flushPromises()

    const exportButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Export')
    expect(exportButton).toBeTruthy()

    await exportButton!.trigger('click')
    await flushPromises()

    expect(composableMocks.download).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('update:open')).toBeTruthy()
    const closeEvents = wrapper.emitted('update:open') ?? []
    expect(closeEvents[closeEvents.length - 1]).toEqual([false])
    expect(toastMocks.success).toHaveBeenCalled()
  })

  it('disables export action when neither selected nor all-matching scope can run', async () => {
    const wrapper = mountDialog({ selectedBookIds: [], selectedCount: 0, allMatchingQuery: undefined, totalCount: 0 })
    await wrapper.setProps({ open: true })
    await flushPromises()

    const exportButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Export')

    expect(exportButton?.attributes('disabled')).toBeDefined()
    expect(composableMocks.preflight).not.toHaveBeenCalled()
  })

  it('loads persisted settings and sends them in preflight request', async () => {
    localStorage.setItem(
      'bookorbit:metadata-export:library',
      JSON.stringify({
        format: 'json',
        columnsMode: 'visible',
        includePersonalData: true,
        includeFilePaths: true,
        includeContextMeta: false,
      }),
    )

    const wrapper = mountDialog({})
    await wrapper.setProps({ open: true })
    await flushPromises()

    const request = composableMocks.preflight.mock.calls[0]?.[0] as ExportRequest
    expect(request.format).toBe('json')
    expect(request.options.columnsMode).toBe('visible')
    expect(request.options.includePersonalData).toBe(true)
    expect(request.options.includeFilePaths).toBe(true)
    expect(request.options.includeContextMeta).toBe(false)
  })

  it('ignores malformed persisted settings and still runs preflight', async () => {
    localStorage.setItem('bookorbit:metadata-export:library', '{bad-json')

    const wrapper = mountDialog({})
    await wrapper.setProps({ open: true })
    await flushPromises()

    const request = composableMocks.preflight.mock.calls[0]?.[0] as ExportRequest
    expect(request.format).toBe('csv')
    expect(request.options.columnsMode).toBe('canonical')
  })

  it('shows preflight errors and surfaces download failures', async () => {
    composableMocks.preflight.mockReset()
    composableMocks.preflight.mockRejectedValue(new Error('Too many rows selected'))
    const wrapper = mountDialog({})
    await wrapper.setProps({ open: true })
    await flushPromises()

    expect(wrapper.text()).toContain('Too many rows selected')

    composableMocks.preflight.mockReset()
    composableMocks.preflight.mockResolvedValue(PREVIEW)
    const optionsCheckboxes = wrapper.findAll('input[type="checkbox"]')
    await optionsCheckboxes[0]?.setValue(true)
    await optionsCheckboxes[1]?.setValue(true)
    await optionsCheckboxes[2]?.setValue(false)
    await flushPromises()

    composableMocks.download.mockRejectedValueOnce(new Error('Metadata export failed hard'))
    const exportButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Export')
    await exportButton?.trigger('click')
    await flushPromises()

    expect(toastMocks.error).toHaveBeenCalledWith('Metadata export failed hard')
  })

  it('supports format and columns-mode switching', async () => {
    const wrapper = mountDialog({})
    await wrapper.setProps({ open: true })
    await flushPromises()

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('JSON'))
      ?.trigger('click')
    await wrapper.find('input[type="radio"][value="visible"]').setValue(true)
    await flushPromises()

    const lastRequest = composableMocks.preflight.mock.calls[composableMocks.preflight.mock.calls.length - 1]?.[0] as ExportRequest
    expect(lastRequest.format).toBe('json')
    expect(lastRequest.options.columnsMode).toBe('visible')
  })
})
