import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref, type Ref } from 'vue'
import type { Library } from '@bookorbit/types'

import AppearanceLibraryVisibilitySettings from '../AppearanceLibraryVisibilitySettings.vue'

type TestUser = { id: number; isSuperuser: boolean; permissions: string[]; settings: Record<string, unknown> }

const state = vi.hoisted(() => ({
  user: null as unknown as Ref<TestUser | null>,
  libraries: null as unknown as Ref<Partial<Library>[]>,
  api: vi.fn<(url: string, init?: RequestInit) => Promise<{ ok: boolean }>>(),
  fetchLibraries: vi.fn<() => Promise<void>>(),
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
}))

vi.mock('@/features/auth/composables/useAuth', () => ({ useAuth: () => ({ user: state.user }) }))
vi.mock('@/lib/api', () => ({ api: state.api }))
vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({ libraries: state.libraries, loaded: ref(true), fetchLibraries: state.fetchLibraries }),
}))
vi.mock('vue-sonner', () => ({ toast: { success: state.toastSuccess, error: state.toastError } }))

function library(id: number, name: string, bookCount: number): Partial<Library> {
  return { id, name, icon: null, bookCount }
}

function mountPage() {
  return mount(AppearanceLibraryVisibilitySettings, {
    global: { stubs: { AppIcon: true, RouterLink: { props: ['to'], template: '<a :data-route="to.name"><slot /></a>' } } },
  })
}

function hide(hidden: Record<string, number[]>) {
  state.user.value = { ...state.user.value!, settings: { libraryVisibility: { hidden } } }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.user = ref<TestUser | null>({ id: 7, isSuperuser: false, permissions: ['hardcover_sync', 'storygraph_sync'], settings: {} })
  state.libraries = ref([library(1, 'Novels', 468), library(2, 'Audiobooks', 4), library(3, 'Comics', 1)])
  state.api.mockResolvedValue({ ok: true })
})

describe('AppearanceLibraryVisibilitySettings', () => {
  it('lists libraries by name with every place shown', () => {
    const wrapper = mountPage()

    const rows = wrapper.findAll('[data-testid^="library-visibility-row-"]')
    expect(rows.map((row) => row.attributes('data-testid'))).toEqual([
      'library-visibility-row-2',
      'library-visibility-row-3',
      'library-visibility-row-1',
    ])
    expect(rows[1]!.text()).toContain('1 book')
    expect(rows[2]!.text()).toContain('468 books')
    expect(wrapper.findAll('button[aria-pressed="true"]')).toHaveLength(0)
    expect(wrapper.get('[data-testid="library-visibility-reset"]').attributes('disabled')).toBeDefined()
    expect(state.fetchLibraries).toHaveBeenCalled()
  })

  it('hides a library from one place when its toggle is pressed', async () => {
    const wrapper = mountPage()
    const toggle = wrapper.get('[data-testid="library-visibility-toggle-1-stats"]')
    expect(toggle.attributes('aria-label')).toBe('Hide Novels from Stats')

    await toggle.trigger('click')
    await flushPromises()

    expect(JSON.parse(String(state.api.mock.calls[0]![1]!.body))).toEqual({
      settings: { libraryVisibility: { hidden: { shelves: [], series: [], stats: [1] } } },
    })
    expect(toggle.attributes('aria-pressed')).toBe('true')
    expect(toggle.text()).toBe('Hidden')
    expect(wrapper.get('[data-testid="library-visibility-row-1"]').text()).toContain('hidden from Stats')
  })

  it('names every place a library is hidden from, and marks one hidden everywhere', () => {
    hide({ shelves: [1, 3], series: [3], stats: [1, 3] })
    const wrapper = mountPage()

    const novels = wrapper.get('[data-testid="library-visibility-row-1"]').text()
    expect(novels).toContain('468 books · hidden from reading shelves and Stats')
    expect(novels).toContain('Hidden in 2 places')

    const comics = wrapper.get('[data-testid="library-visibility-row-3"]').text()
    expect(comics).toContain('Hidden everywhere')
  })

  it('shows every library again from the reset action', async () => {
    hide({ stats: [2] })
    const wrapper = mountPage()

    await wrapper.get('[data-testid="library-visibility-reset"]').trigger('click')
    await flushPromises()

    expect(JSON.parse(String(state.api.mock.calls[0]![1]!.body))).toEqual({
      settings: { libraryVisibility: { hidden: { shelves: [], series: [], stats: [] } } },
    })
    expect(state.toastSuccess).toHaveBeenCalledWith('Every library shown again')
  })

  it('reports a failed save and puts the toggle back', async () => {
    state.api.mockResolvedValue({ ok: false })
    const wrapper = mountPage()
    const toggle = wrapper.get('[data-testid="library-visibility-toggle-2-series"]')

    await toggle.trigger('click')
    await flushPromises()

    expect(state.toastError).toHaveBeenCalledWith('Could not save library visibility')
    expect(toggle.attributes('aria-pressed')).toBe('false')
  })

  it('links only to the sync services this account can use', () => {
    state.user.value = { ...state.user.value!, permissions: ['storygraph_sync'] }
    const wrapper = mountPage()

    expect(wrapper.findAll('a[data-route]').map((link) => link.attributes('data-route'))).toEqual(['settings-storygraph'])
    expect(wrapper.text()).toContain('Its settings page has its own list of libraries that never sync.')
  })

  it('leaves out the sync section without either sync permission', () => {
    state.user.value = { ...state.user.value!, permissions: [] }
    const wrapper = mountPage()

    expect(wrapper.findAll('a[data-route]')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('never sync')
  })
})
