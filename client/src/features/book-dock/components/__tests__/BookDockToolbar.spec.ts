import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import BookDockToolbar from '../BookDockToolbar.vue'

const permissionState = {
  demoRestricted: false,
}

const files = ref<{ status: 'done' | 'error' | 'uploading' }[]>([])
const isUploading = ref(false)
const addFiles = vi.fn<(...args: unknown[]) => unknown>()
const clearCompleted = vi.fn<() => void>()
const apiMock = vi.fn<(...args: unknown[]) => Promise<{ ok: boolean }>>()

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({
    isDemoRestrictedAccount: {
      get value() {
        return permissionState.demoRestricted
      },
    },
  }),
}))

vi.mock('../../composables/useBookDockUpload', () => ({
  SUPPORTED_FORMATS_ACCEPT: '.epub,.pdf',
  useBookDockUpload: () => ({
    files,
    isUploading,
    addFiles,
    clearCompleted,
  }),
}))

vi.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => apiMock(...args),
}))

function mountToolbar(overrides: Partial<{ paused: boolean; hasSelection: boolean; fetchedCount: number; errorCount: number }> = {}) {
  return mount(BookDockToolbar, {
    props: {
      activeStatus: undefined,
      selectionCount: 2,
      hasSelection: true,
      fetchedCount: 1,
      errorCount: 1,
      paused: false,
      ...overrides,
    },
    global: {
      stubs: {
        Tooltip: { template: '<div><slot /></div>' },
        TooltipTrigger: { template: '<div><slot /></div>' },
        TooltipContent: { template: '<div><slot /></div>' },
      },
    },
  })
}

describe('BookDockToolbar demo restriction', () => {
  beforeEach(() => {
    vi.useRealTimers()
    permissionState.demoRestricted = false
    files.value = []
    isUploading.value = false
    addFiles.mockReset()
    clearCompleted.mockReset()
    apiMock.mockReset()
  })

  it('shows bulk edit action when account is not demo restricted', () => {
    const wrapper = mountToolbar()
    expect(wrapper.find('[data-testid="book-dock-bulk-edit"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Finalize')
  })

  it('hides bulk edit action when account is demo restricted', () => {
    permissionState.demoRestricted = true
    const wrapper = mountToolbar()
    expect(wrapper.find('[data-testid="book-dock-bulk-edit"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Finalize')
  })

  it('emits status filter and search events', async () => {
    vi.useFakeTimers()
    const wrapper = mountToolbar()

    await wrapper
      .findAll('button')
      .find((btn) => btn.text() === 'Ready')
      ?.trigger('click')
    expect(wrapper.emitted('statusFilter')?.[0]).toEqual(['ready'])

    await wrapper.find('[data-testid="book-dock-search-toggle"]').trigger('click')
    const searchInput = wrapper.find('input[placeholder="Search files..."]')
    await searchInput.setValue('abc')
    vi.advanceTimersByTime(301)
    await nextTick()
    expect(wrapper.emitted('search')?.[0]).toEqual(['abc'])

    await wrapper.find('[data-testid="book-dock-search-clear"]').trigger('click')
    expect(wrapper.emitted('search')?.[1]).toEqual([''])
  })

  it('calls upload composable when files are selected', async () => {
    const wrapper = mountToolbar()
    const uploadButton = wrapper.find('[data-testid="book-dock-upload"]')
    const input = wrapper.find('input[type="file"]')
    const clickSpy = vi.fn<() => void>()
    ;(input.element as HTMLInputElement).click = clickSpy
    await uploadButton.trigger('click')
    expect(clearCompleted).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)

    const wrapperWithFile = mountToolbar()
    const inputWithFile = wrapperWithFile.find('input[type="file"]')
    const file = new File(['book'], 'book.epub', { type: 'application/epub+zip' })
    const filesList = {
      length: 1,
      item: () => file,
      0: file,
      [Symbol.iterator]: function* () {
        yield file
      },
    } as unknown as FileList

    Object.defineProperty(inputWithFile.element, 'files', {
      value: filesList,
      configurable: true,
    })
    await inputWithFile.trigger('change')
    expect(addFiles).toHaveBeenCalledWith(filesList)
  })

  it('emits rescan on successful API response', async () => {
    apiMock.mockResolvedValue({ ok: true })
    const wrapper = mountToolbar()
    await wrapper.find('[data-testid="book-dock-rescan"]').trigger('click')
    await nextTick()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/book-dock/rescan', { method: 'POST' })
    expect(wrapper.emitted('rescan')).toHaveLength(1)
  })

  it('calls pause and resume endpoints from the processing toggle', async () => {
    apiMock.mockResolvedValue({ ok: true })
    const runningWrapper = mountToolbar()
    await runningWrapper.find('[data-testid="book-dock-processing-toggle"]').trigger('click')
    await nextTick()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/book-dock/pause', { method: 'POST' })
    expect(runningWrapper.emitted('pause')).toHaveLength(1)

    apiMock.mockClear()
    const pausedWrapper = mountToolbar({ paused: true })
    await pausedWrapper.find('[data-testid="book-dock-processing-toggle"]').trigger('click')
    await nextTick()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/book-dock/resume', { method: 'POST' })
    expect(pausedWrapper.emitted('resume')).toHaveLength(1)
  })

  it('emits pauseError when the pause endpoint fails', async () => {
    apiMock.mockResolvedValue({ ok: false })
    const wrapper = mountToolbar()

    await wrapper.find('[data-testid="book-dock-processing-toggle"]').trigger('click')
    await nextTick()

    expect(wrapper.emitted('pauseError')).toHaveLength(1)
  })

  it('emits rescanError when API call fails', async () => {
    apiMock.mockRejectedValue(new Error('network down'))
    const wrapper = mountToolbar()
    await wrapper.find('[data-testid="book-dock-rescan"]').trigger('click')
    await nextTick()

    expect(wrapper.emitted('rescanError')).toHaveLength(1)
  })

  it('emits selection action events from the action row', async () => {
    const wrapper = mountToolbar()
    await wrapper.find('[data-testid="book-dock-finalize"]').trigger('click')
    await wrapper.find('[data-testid="book-dock-set-destination"]').trigger('click')
    await wrapper.find('[data-testid="book-dock-apply-fetched"]').trigger('click')
    await wrapper.find('[data-testid="book-dock-retry-errors"]').trigger('click')
    await wrapper.find('[data-testid="book-dock-bulk-edit"]').trigger('click')
    await wrapper.find('[data-testid="book-dock-bulk-discard"]').trigger('click')

    expect(wrapper.emitted('finalize')).toHaveLength(1)
    expect(wrapper.emitted('setDestination')).toHaveLength(1)
    expect(wrapper.emitted('applyFetched')).toHaveLength(1)
    expect(wrapper.emitted('retryFetch')).toHaveLength(1)
    expect(wrapper.emitted('bulkEdit')).toHaveLength(1)
    expect(wrapper.emitted('bulkDiscard')).toHaveLength(1)
  })

  it('shows and auto-hides upload progress popover', async () => {
    vi.useFakeTimers()
    const wrapper = mountToolbar()

    files.value = [{ status: 'done' }, { status: 'error' }]
    isUploading.value = true
    await nextTick()
    expect(wrapper.text()).toContain('Uploading...')
    expect(wrapper.text()).toContain('2 total')

    isUploading.value = false
    await nextTick()
    expect(wrapper.text()).toContain('Done')
    vi.advanceTimersByTime(3001)
    await nextTick()
    expect(wrapper.text()).not.toContain('2 total')
  })
})
