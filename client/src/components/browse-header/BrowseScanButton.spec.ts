import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import type { ScanProgressEvent } from '@bookorbit/types'
import BrowseScanButton from './BrowseScanButton.vue'

const mocks = vi.hoisted(() => ({
  scanLibrary: vi.fn<(library: { id: number; type: string; name: string }) => Promise<boolean>>(),
  progress: undefined as unknown as { value: ScanProgressEvent | undefined },
}))

vi.mock('@/features/scanner/composables/useLibraryScan', () => ({ useLibraryScan: () => ({ scanLibrary: mocks.scanLibrary }) }))
vi.mock('@/features/scanner/composables/useScanProgress', () => ({
  useScanProgress: () => ({ getProgress: () => mocks.progress.value }),
}))

const library = { id: 1, type: 'books' as const, name: 'Novels' }

function running(processed: number, total: number): ScanProgressEvent {
  return { jobId: 7, libraryId: 1, status: 'running', processed, total, added: 0, updated: 0, missing: 0 }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('BrowseScanButton', () => {
  it('starts a scan of its library', async () => {
    mocks.progress = ref(undefined)
    mocks.scanLibrary.mockResolvedValue(true)
    const wrapper = mount(BrowseScanButton, { props: { library } })

    expect(wrapper.text()).toContain('Scan')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(mocks.scanLibrary).toHaveBeenCalledWith(library)
  })

  it('fills with the scan progress and ignores clicks while it runs', async () => {
    mocks.progress = ref(running(212, 454))
    const wrapper = mount(BrowseScanButton, { props: { library } })

    expect(wrapper.text()).toContain('Scanning')
    expect(wrapper.text()).toContain('212 / 454 books')
    expect(wrapper.get('button').attributes('aria-busy')).toBe('true')
    expect((wrapper.get('[style]').element as HTMLElement).style.width).toBe('47%')

    await wrapper.get('button').trigger('click')
    expect(mocks.scanLibrary).not.toHaveBeenCalled()
  })

  it('announces when the scan starts and finishes', async () => {
    mocks.progress = ref(undefined)
    const wrapper = mount(BrowseScanButton, { props: { library } })
    const status = () => wrapper.get('[role="status"]').text()

    mocks.progress.value = running(1, 10)
    await nextTick()
    expect(status()).toBe('Scanning Novels')

    mocks.progress.value = { ...running(10, 10), status: 'completed' }
    await nextTick()
    expect(status()).toBe('Scan of Novels finished')
  })
})
