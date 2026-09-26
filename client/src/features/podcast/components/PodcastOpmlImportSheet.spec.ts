import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { jsonResponse } from '../test/fixtures'
import { sheetStubs } from '../test/stubs'
import PodcastOpmlImportSheet from './PodcastOpmlImportSheet.vue'

vi.mock('@/lib/api', () => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(null, { status: 204 })),
}))
const toastMocks = vi.hoisted(() => ({ success: vi.fn<() => void>(), error: vi.fn<() => void>(), info: vi.fn<() => void>() }))
vi.mock('vue-sonner', () => ({ toast: toastMocks }))

const apiMock = vi.mocked(api)

function mountSheet() {
  return mount(PodcastOpmlImportSheet, {
    props: { open: true, libraryId: 7 },
    global: { stubs: sheetStubs() },
  })
}

describe('PodcastOpmlImportSheet', () => {
  beforeEach(() => {
    apiMock.mockReset()
    apiMock.mockResolvedValue(jsonResponse({ total: 12, queued: 12 }))
    toastMocks.success.mockClear()
  })

  it('applies the chosen acquisition policy to every feed in the import', async () => {
    const wrapper = mountSheet()
    expect(wrapper.text()).toContain('No file chosen')

    const fileInput = wrapper.get('input[type="file"]')
    Object.defineProperty(fileInput.element, 'files', { configurable: true, value: [new File(['<opml />'], 'shows.opml')] })
    await fileInput.trigger('change')
    expect(wrapper.get('[data-testid="podcast-import-filename"]').text()).toBe('shows.opml')

    await wrapper.get('select[aria-label="Automatic downloads"]').setValue('newest')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Import')!
      .trigger('click')
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/podcast-libraries/7/opml/import',
      expect.objectContaining({ body: JSON.stringify({ opml: '<opml />', acquisitionPolicy: 'newest', autoDownloadLimit: 3 }) }),
    )
    expect(toastMocks.success).toHaveBeenCalledWith('Queued 12 podcast feeds')
    expect(wrapper.emitted('imported')).toEqual([[{ total: 12, queued: 12 }]])
  })

  it('keeps the import disabled until a file is chosen', () => {
    const wrapper = mountSheet()

    const importButton = wrapper.findAll('button').find((button) => button.text() === 'Import')!
    expect(importButton.attributes('disabled')).toBeDefined()
  })
})
