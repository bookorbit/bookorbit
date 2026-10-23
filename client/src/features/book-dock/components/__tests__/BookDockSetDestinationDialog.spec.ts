import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Library } from '@bookorbit/types'
import { i18n } from '@/i18n'
import { makeLibrary } from '@/features/library/test/fixtures'
import BookDockSetDestinationDialog from '../BookDockSetDestinationDialog.vue'

const libraries = ref<Library[]>([])
const loaded = ref(true)
const loading = ref(false)
const error = ref<string | null>(null)
const fetchLibraries = vi.fn<() => Promise<void>>()
const api = vi.fn<(...args: unknown[]) => Promise<Response>>()
vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({ libraries, loaded, loading, error, fetchLibraries, refreshLibraries: vi.fn<() => Promise<void>>() }),
}))
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => api(...args) }))
let wrapper: VueWrapper
function mountDialog() {
  wrapper = mount(BookDockSetDestinationDialog, {
    props: { selectionPayload: { selectAll: true, excludedIds: [12], search: 'Dune' }, selectionCount: 2 },
    global: { stubs: { Teleport: true } },
  })
}
function applyButton() {
  return wrapper.findAll('button').find((button) => button.text().trim() === 'Apply')!
}

beforeEach(() => {
  i18n.global.locale.value = 'en'
  libraries.value = [makeLibrary()]
  loaded.value = true
  loading.value = false
  error.value = null
  fetchLibraries.mockReset().mockResolvedValue(undefined)
  api.mockReset().mockResolvedValue({ ok: true, json: async () => ({ total: 2, updated: 2, failed: 0 }) } as Response)
})
afterEach(() => wrapper?.unmount())

describe('BookDockSetDestinationDialog', () => {
  it('shows a sole destination as text and applies it to the unchanged selection payload', async () => {
    mountDialog()
    await flushPromises()
    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.text()).toContain('Main Library')
    expect(wrapper.text()).toContain('/books')
    expect(api).not.toHaveBeenCalled()
    await applyButton().trigger('click')
    expect(api).toHaveBeenCalledExactlyOnceWith('/api/v1/book-dock/files/set-target', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectAll: true, excludedIds: [12], search: 'Dune', targetLibraryId: 3, targetFolderId: 30 }),
    })
  })

  it('keeps multiple folders selectable without requiring a library choice', async () => {
    libraries.value[0]!.folders.push({ ...libraries.value[0]!.folders[0]!, id: 31, path: '/books/second' })
    mountDialog()
    await flushPromises()
    expect(wrapper.findAll('select')).toHaveLength(1)
    await wrapper.get('select').setValue('31')
    await applyButton().trigger('click')
    expect(JSON.parse((api.mock.calls[0]![1] as RequestInit).body as string).targetFolderId).toBe(31)
  })

  it('keeps the existing first-library default and updates the folder when choosing another', async () => {
    libraries.value.unshift(makeLibrary({ id: 1, type: 'podcasts', name: 'Podcasts' }))
    libraries.value.push(makeLibrary({ id: 4, name: 'Comics', folders: [{ id: 40, path: '/comics', role: 'downloads', createdAt: '2026-01-01' }] }))
    mountDialog()
    await flushPromises()
    expect(wrapper.get<HTMLSelectElement>('select').element.value).toBe('3')
    expect(wrapper.text()).not.toContain('Podcasts')
    await wrapper.get('select').setValue('4')
    await applyButton().trigger('click')
    expect(JSON.parse((api.mock.calls[0]![1] as RequestInit).body as string)).toMatchObject({ targetLibraryId: 4, targetFolderId: 40 })
  })

  it.each(['empty', 'folderless', 'failed', 'loading'])('does not submit for a %s destination', async (scenario) => {
    if (scenario === 'empty') libraries.value = []
    if (scenario === 'folderless') libraries.value[0]!.folders = []
    if (scenario === 'failed') error.value = 'HTTP 503'
    if (scenario === 'loading') loading.value = true
    mountDialog()
    await flushPromises()
    expect(applyButton().attributes('disabled')).toBeDefined()
    await applyButton().trigger('click')
    expect(api).not.toHaveBeenCalled()
  })

  it('enables Apply when a delayed library list arrives', async () => {
    libraries.value = []
    loaded.value = false
    mountDialog()
    await flushPromises()
    expect(applyButton().attributes('disabled')).toBeDefined()
    libraries.value = [makeLibrary()]
    loaded.value = true
    await flushPromises()
    expect(applyButton().attributes('disabled')).toBeUndefined()
    expect(wrapper.find('select').exists()).toBe(false)
  })
})
