import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { BookDockFinalizeResult } from '@bookorbit/types'
import BookDockFinalizeDialog from '../BookDockFinalizeDialog.vue'
import { i18n } from '@/i18n'
import { makeLibrary } from '@/features/library/test/fixtures'

const selectionSummary = ref({ total: 2, withDestination: 0, withoutDestination: 2 })
const apiMock = vi.fn<(...args: unknown[]) => Promise<Response>>()
const finalizeResult = ref<BookDockFinalizeResult | null>(null)
const finalizeLoading = ref(false)
const finalizeError = ref<string | null>(null)
const finalizeMock = vi.fn<(...args: unknown[]) => Promise<void>>()
const resetMock = vi.fn<() => void>()
const fetchLibrariesMock = vi.fn<() => Promise<void>>()
const libraryOptions = ref([
  makeLibrary({ id: 2, name: 'Main', folders: [{ id: 3, path: '/books', role: 'downloads', createdAt: '2026-01-01T00:00:00.000Z' }] }),
])
const librariesLoaded = ref(true)
const librariesLoading = ref(false)
const librariesError = ref<string | null>(null)
const refreshLibrariesMock = vi.fn<() => void>()

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn<(...args: unknown[]) => void>(),
  }),
}))

vi.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => apiMock(...args),
}))

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({
    libraries: libraryOptions,
    loaded: librariesLoaded,
    loading: librariesLoading,
    error: librariesError,
    fetchLibraries: fetchLibrariesMock,
    refreshLibraries: refreshLibrariesMock,
  }),
}))

vi.mock('../../composables/useBookDockFinalize', () => ({
  useBookDockFinalize: () => ({
    result: finalizeResult,
    loading: finalizeLoading,
    error: finalizeError,
    finalize: finalizeMock,
    reset: resetMock,
  }),
}))

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn<() => Promise<unknown>>().mockResolvedValue(body),
  } as unknown as Response
}

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))

function mountDialog() {
  const wrapper = mount(BookDockFinalizeDialog, {
    props: {
      selectionPayload: { fileIds: [10, 11] },
      selectionCount: 2,
    },
    global: {
      stubs: {
        Teleport: true,
      },
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

describe('BookDockFinalizeDialog', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'en'
    libraryOptions.value = [
      makeLibrary({ id: 2, name: 'Main', folders: [{ id: 3, path: '/books', role: 'downloads', createdAt: '2026-01-01T00:00:00.000Z' }] }),
    ]
    selectionSummary.value = { total: 2, withDestination: 0, withoutDestination: 2 }
    librariesLoaded.value = true
    librariesLoading.value = false
    librariesError.value = null
    apiMock.mockReset()
    finalizeResult.value = null
    finalizeLoading.value = false
    finalizeError.value = null
    finalizeMock.mockReset()
    resetMock.mockReset()
    fetchLibrariesMock.mockResolvedValue(undefined)
    refreshLibrariesMock.mockReset()
    let duplicateDiscarded = false

    apiMock.mockImplementation(async (url) => {
      if (url === '/api/v1/book-dock/files/selection-summary') {
        return jsonResponse(selectionSummary.value)
      }

      if (url === '/api/v1/book-dock/finalize/preview') {
        return jsonResponse(
          !duplicateDiscarded
            ? {
                total: 2,
                ready: 1,
                duplicates: 1,
                destinationConflicts: 0,
                missingDestination: 0,
                blocked: 0,
                truncated: false,
                itemLimit: 200,
                items: [
                  {
                    fileId: 10,
                    fileName: 'duplicate.epub',
                    status: 'duplicate',
                    existingBookId: 42,
                    message: 'A file with this name already exists at the target location',
                  },
                  { fileId: 11, fileName: 'ready.epub', newName: 'ready.epub', status: 'ready' },
                ],
              }
            : {
                total: 1,
                ready: 1,
                duplicates: 0,
                destinationConflicts: 0,
                missingDestination: 0,
                blocked: 0,
                truncated: false,
                itemLimit: 200,
                items: [{ fileId: 11, fileName: 'ready.epub', newName: 'ready.epub', status: 'ready' }],
              },
        )
      }

      if (url === '/api/v1/book-dock/finalize/discard-duplicates') {
        duplicateDiscarded = true
        return jsonResponse({ total: 2, discarded: 1, skipped: 1, discardedFileIds: [10] })
      }

      return jsonResponse({}, 404)
    })
  })

  it('shows duplicate preflight count and discards duplicate candidates with the resolved destination', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    expect(wrapper.text()).toContain('1 already in library')
    const discardButton = wrapper.findAll('button').find((button) => button.text().includes('Discard duplicates'))
    expect(discardButton).toBeTruthy()
    if (!discardButton) throw new Error('Discard duplicates button not found')

    await discardButton.trigger('click')
    await flushPromises()

    const discardCall = apiMock.mock.calls.find(([url]) => url === '/api/v1/book-dock/finalize/discard-duplicates')
    expect(discardCall).toBeTruthy()
    if (!discardCall) throw new Error('Discard duplicates API call not found')
    const body = JSON.parse(((discardCall[1] as RequestInit).body as string) ?? '{}')
    expect(body).toEqual({
      fileIds: [10, 11],
      defaultLibraryId: 2,
      defaultFolderId: 3,
    })
    expect(wrapper.text()).not.toContain('1 already in library')
  })

  it('offers navigation and rename for an indexed destination collision without an import-anyway action', async () => {
    finalizeResult.value = {
      total: 1,
      succeeded: 0,
      failed: 1,
      results: [
        {
          fileId: 10,
          fileName: 'duplicate.epub',
          newName: 'Author/Title/duplicate.epub',
          success: false,
          isDuplicate: true,
          existingBookId: 42,
          message: 'A file with this name already exists at the target location',
        },
      ],
    }

    const wrapper = mountDialog()
    await flushPromises()

    expect(wrapper.text()).toContain('View existing')
    expect(wrapper.text()).toContain('Already exists - save as')
    expect(wrapper.text()).toContain('Import')
    expect(wrapper.text()).not.toContain('Import anyway')
    expect(wrapper.find('input[type="text"]').exists()).toBe(true)
  })
  function startButton(wrapper: ReturnType<typeof mountDialog>) {
    return wrapper.findAll('button').find((button) => button.text().trim() === 'Start')!
  }

  it('shows a sole destination as text and files only after explicit confirmation', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.text()).toContain('Main')
    expect(wrapper.text()).toContain('/books')
    expect(finalizeMock).not.toHaveBeenCalled()
    await startButton(wrapper).trigger('click')
    expect(finalizeMock).toHaveBeenCalledExactlyOnceWith({ fileIds: [10, 11], defaultLibraryId: 2, defaultFolderId: 3 })
  })

  it('keeps multiple folders selectable and uses the chosen folder in preview and finalization', async () => {
    libraryOptions.value[0]!.folders.push({ ...libraryOptions.value[0]!.folders[0]!, id: 4, path: '/books/second' })
    const wrapper = mountDialog()
    await flushPromises()
    expect(wrapper.findAll('select')).toHaveLength(1)
    await wrapper.get('select').setValue('4')
    await flushPromises()
    const previewCalls = apiMock.mock.calls.filter(([url]) => url === '/api/v1/book-dock/finalize/preview')
    const body = JSON.parse((previewCalls.at(-1)![1] as RequestInit).body as string)
    expect(body.defaultFolderId).toBe(4)
    await startButton(wrapper).trigger('click')
    expect(finalizeMock).toHaveBeenCalledWith({ fileIds: [10, 11], defaultLibraryId: 2, defaultFolderId: 4 })
  })

  it('preserves the first-library default with multiple choices and excludes podcasts', async () => {
    libraryOptions.value.unshift(makeLibrary({ id: 1, type: 'podcasts', name: 'Podcasts' }))
    libraryOptions.value.push(makeLibrary({ id: 5, name: 'Comics' }))
    const wrapper = mountDialog()
    await flushPromises()
    expect(wrapper.get<HTMLSelectElement>('select').element.value).toBe('2')
    expect(wrapper.text()).not.toContain('Podcasts')
    await wrapper.get('select').setValue('5')
    await flushPromises()
    await startButton(wrapper).trigger('click')
    expect(finalizeMock).toHaveBeenCalledWith({ fileIds: [10, 11], defaultLibraryId: 5, defaultFolderId: 30 })
  })

  it.each(['empty', 'folderless', 'failed', 'loading'])('blocks filing and preview for a %s fallback destination', async (scenario) => {
    if (scenario === 'empty') libraryOptions.value = []
    if (scenario === 'folderless') libraryOptions.value[0]!.folders = []
    if (scenario === 'failed') librariesError.value = 'HTTP 503'
    if (scenario === 'loading') librariesLoading.value = true
    const wrapper = mountDialog()
    await flushPromises()
    expect(startButton(wrapper).attributes('disabled')).toBeDefined()
    await startButton(wrapper).trigger('click')
    expect(finalizeMock).not.toHaveBeenCalled()
    expect(apiMock.mock.calls.some(([url]) => url === '/api/v1/book-dock/finalize/preview')).toBe(false)
  })

  it('does not send a fallback when all files already carry destinations', async () => {
    selectionSummary.value = { total: 2, withDestination: 2, withoutDestination: 0 }
    const wrapper = mountDialog()
    await flushPromises()
    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('/books')
    await startButton(wrapper).trigger('click')
    expect(finalizeMock).toHaveBeenCalledExactlyOnceWith({ fileIds: [10, 11] })
    const previewCall = apiMock.mock.calls.find(([url]) => url === '/api/v1/book-dock/finalize/preview')!
    expect(JSON.parse((previewCall[1] as RequestInit).body as string)).toEqual({ fileIds: [10, 11] })
  })
  it('ignores a late preview after the selected destination becomes unavailable', async () => {
    const completePreviews: Array<(response: Response) => void> = []
    apiMock.mockImplementation(async (url) => {
      if (url === '/api/v1/book-dock/files/selection-summary') return jsonResponse(selectionSummary.value)
      return new Promise<Response>((resolve) => {
        completePreviews.push(resolve)
      })
    })
    const wrapper = mountDialog()
    await flushPromises()
    expect(completePreviews.length).toBeGreaterThan(0)
    libraryOptions.value[0]!.folders = []
    await flushPromises()
    for (const complete of completePreviews) {
      complete(
        jsonResponse({
          total: 2,
          ready: 2,
          duplicates: 0,
          destinationConflicts: 0,
          missingDestination: 0,
          blocked: 0,
          truncated: false,
          itemLimit: 200,
          items: [{ fileId: 10, fileName: 'stale.epub', newName: 'stale-name.epub', status: 'ready' }],
        }),
      )
    }
    await flushPromises()
    expect(wrapper.text()).not.toContain('stale-name.epub')
    expect(startButton(wrapper).attributes('disabled')).toBeDefined()
    expect(finalizeMock).not.toHaveBeenCalled()
  })
})
