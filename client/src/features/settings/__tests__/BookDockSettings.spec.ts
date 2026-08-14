import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import type { BookDockSettings as BookDockSettingsResponse } from '@bookorbit/types'

const { apiMock, fetchLibrariesMock, toastErrorMock } = vi.hoisted(() => ({
  apiMock: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
  fetchLibrariesMock: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  toastErrorMock: vi.fn<(message: string) => void>(),
}))

vi.mock('@/lib/api', () => ({ api: apiMock }))
vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({
    libraries: ref([
      {
        id: 4,
        name: 'Library',
        folders: [{ id: 8, path: '/books' }],
      },
    ]),
    fetchLibraries: fetchLibrariesMock,
  }),
}))
vi.mock('vue-sonner', () => ({
  toast: {
    success: vi.fn<(message: string) => void>(),
    error: toastErrorMock,
  },
}))

import BookDockSettings from '../BookDockSettings.vue'

const settings: BookDockSettingsResponse = {
  bookDockPath: '/data/private-book-dock',
  autoFetchMetadata: true,
  autoFinalizeEnabled: true,
  autoFinalizeThreshold: 85,
  autoFinalizeLibraryId: 4,
  autoFinalizeFolderId: 8,
  autoFinalizeMetadataMode: 'safe_merge',
}

function response(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 403,
    json: vi.fn<() => Promise<unknown>>().mockResolvedValue(body),
  } as unknown as Response
}

async function mountSettings() {
  const wrapper = mount(BookDockSettings, { props: { embedded: true } })
  await flushPromises()
  return wrapper
}

describe('BookDockSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchLibrariesMock.mockResolvedValue(undefined)
    apiMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/book-dock/settings' && init?.method === 'PUT') {
        return response({ ...settings, ...JSON.parse(String(init.body)) })
      }
      return response(settings)
    })
  })

  it('loads the protected settings contract and renders its scoped path', async () => {
    const wrapper = await mountSettings()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/book-dock/settings')
    expect(fetchLibrariesMock).toHaveBeenCalledOnce()
    expect(wrapper.get('[data-testid="book-dock-path"]').text()).toBe('/data/private-book-dock')
    expect(apiMock.mock.calls.some(([url]) => url === '/api/v1/app-info' || url === '/api/v1/app-settings')).toBe(false)
  })

  it('updates the complete typed settings document through the protected endpoint', async () => {
    const wrapper = await mountSettings()

    await wrapper.findAll('[role="switch"]')[0]!.trigger('click')
    await flushPromises()

    expect(apiMock).toHaveBeenLastCalledWith('/api/v1/book-dock/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        autoFetchMetadata: false,
        autoFinalizeEnabled: true,
        autoFinalizeThreshold: 85,
        autoFinalizeLibraryId: 4,
        autoFinalizeFolderId: 8,
        autoFinalizeMetadataMode: 'safe_merge',
      }),
    })
  })

  it('reports a failed update without applying the optimistic value', async () => {
    apiMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/book-dock/settings' && init?.method === 'PUT') return response({}, false)
      return response(settings)
    })
    const wrapper = await mountSettings()

    await wrapper.findAll('[role="switch"]')[0]!.trigger('click')
    await flushPromises()

    expect(toastErrorMock).toHaveBeenCalledOnce()
    expect(wrapper.findAll('[role="switch"]')[0]!.attributes('aria-checked')).toBe('true')
  })
})
