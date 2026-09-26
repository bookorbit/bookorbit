import { describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { ref } from 'vue'
import BookDockView from '../BookDockView.vue'

const apiMock = vi.fn<(url: string) => Promise<Response>>(
  async (_url: string) =>
    ({
      ok: true,
      json: async () => ({ items: [], total: 7000, page: 1, size: 20 }),
    }) as Response,
)

vi.mock('@/lib/api', () => ({ api: (url: string) => apiMock(url) }))
vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ isDemoRestrictedAccount: ref(false), hasPermission: () => false }),
}))
vi.mock('@/features/book-dock/composables/useBookDockSummary', () => ({
  useBookDockSummary: () => ({
    summary: ref({ total: 7000, paused: false }),
    fetchSummary: vi.fn<() => void>(),
    subscribe: vi.fn<() => void>(),
    onBookDockChange: () => vi.fn<() => void>(),
    socketConnected: ref(true),
  }),
}))
vi.mock('@/features/book-dock/composables/useBookDockStatistics', () => ({
  useBookDockStatistics: () => ({ statistics: ref(null), fetchStatistics: vi.fn<() => void>() }),
}))
vi.mock('@/features/book-dock/composables/useBookDockUpload', () => ({
  useBookDockUpload: () => ({ addFiles: vi.fn<() => void>(), isUploading: ref(false) }),
  SUPPORTED_FORMATS: ['epub'],
  SUPPORTED_FORMATS_ACCEPT: '.epub',
}))
vi.mock('@/features/book-dock/composables/useBookDockConflicts', () => ({
  useBookDockConflicts: () => ({ conflicts: ref([]), scheduleConflicts: vi.fn<() => void>(), cancelConflicts: vi.fn<() => void>() }),
}))

describe('BookDockView pagination', () => {
  it('keeps a 7000-file dock navigable without rendering hundreds of buttons', async () => {
    const wrapper = shallowMount(BookDockView, { global: { stubs: { PaginationNav: false } } })
    await vi.waitFor(() => expect(wrapper.findAll('nav button')).toHaveLength(6))

    expect(
      wrapper
        .findAll('nav button')
        .map((button) => button.text())
        .filter(Boolean),
    ).toEqual(['1', '2', '349', '350'])
    expect(wrapper.get('[aria-current="page"]').text()).toBe('1')
    expect(String(apiMock.mock.calls[0]?.[0])).toContain('limit=20')

    await wrapper.get('[aria-label="Go to page 350"]').trigger('click')
    await vi.waitFor(() => expect(String(apiMock.mock.calls.at(-1)?.[0])).toContain('page=350'))
    expect(wrapper.get('[aria-current="page"]').text()).toBe('350')
    wrapper.unmount()
  })
})
