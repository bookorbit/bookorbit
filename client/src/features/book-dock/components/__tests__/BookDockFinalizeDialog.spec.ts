import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import BookDockFinalizeDialog from '../BookDockFinalizeDialog.vue'

const apiMock = vi.fn<(...args: unknown[]) => Promise<Response>>()
const finalizeResult = ref(null)
const finalizeLoading = ref(false)
const finalizeError = ref<string | null>(null)
const finalizeMock = vi.fn<(...args: unknown[]) => Promise<void>>()
const resetMock = vi.fn<() => void>()
const fetchLibrariesMock = vi.fn<() => Promise<void>>()
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
    libraries: ref([{ id: 2, name: 'Main', folders: [{ id: 3, path: '/books' }] }]),
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

function mountDialog() {
  return mount(BookDockFinalizeDialog, {
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
}

describe('BookDockFinalizeDialog', () => {
  beforeEach(() => {
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
        return jsonResponse({ total: 2, withDestination: 0, withoutDestination: 2 })
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
                    message: 'Duplicate: this book already exists in the library',
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
})
