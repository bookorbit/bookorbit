import { mount } from '@vue/test-utils'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import type { Library } from '@bookorbit/types'

const librariesRef = ref<Library[]>([])
const fetchLibraries = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({
    libraries: librariesRef,
    loading: ref(false),
    loaded: ref(true),
    fetchLibraries,
  }),
}))

import MoveBooksDialog from '../MoveBooksDialog.vue'

function makeLibrary(overrides: Partial<Library> = {}): Library {
  return {
    id: 1,
    name: 'SF&F',
    folders: [{ id: 11, path: '/books/sff', createdAt: '2026-01-01T00:00:00.000Z' }],
    ...overrides,
  } as Library
}

function mountDialog(props: { open?: boolean; count?: number; currentLibraryId?: number | null } = {}) {
  return mount(MoveBooksDialog, {
    props: {
      open: true,
      count: 2,
      currentLibraryId: null,
      ...props,
    },
    global: {
      stubs: { Teleport: true },
    },
  })
}

describe('MoveBooksDialog', () => {
  beforeEach(() => {
    fetchLibraries.mockClear()
    librariesRef.value = [
      makeLibrary(),
      makeLibrary({ id: 2, name: 'Thrillers', folders: [{ id: 21, path: '/books/thrillers', createdAt: '2026-01-01T00:00:00.000Z' }] }),
      makeLibrary({
        id: 3,
        name: 'Multi',
        folders: [
          { id: 31, path: '/books/multi-a', createdAt: '2026-01-01T00:00:00.000Z' },
          { id: 32, path: '/books/multi-b', createdAt: '2026-01-01T00:00:00.000Z' },
        ],
      }),
    ]
  })

  it('renders translated title, labels, and buttons through the i18n keys', () => {
    const wrapper = mountDialog({ count: 2 })

    expect(wrapper.text()).toContain('Move 2 books to library')
    expect(wrapper.text()).toContain('Target library')
    expect(wrapper.find('[data-testid="move-library-select"] option').text()).toBe('Select a library…')
    expect(wrapper.find('[data-testid="move-cancel"]').text()).toBe('Cancel')
    expect(wrapper.find('[data-testid="move-confirm"]').text()).toBe('Move')
  })

  it('uses the singular title form for a single book', () => {
    const wrapper = mountDialog({ count: 1 })

    expect(wrapper.text()).toContain('Move 1 book to library')
  })

  it('lists all libraries except the current one', () => {
    const wrapper = mountDialog({ currentLibraryId: 1 })

    const options = wrapper.find('[data-testid="move-library-select"]').findAll('option')
    const labels = options.map((option) => option.text())
    expect(labels).toContain('Thrillers')
    expect(labels).toContain('Multi')
    expect(labels).not.toContain('SF&F')
  })

  it('confirms with the selected library without a folder id for single-folder libraries', async () => {
    const wrapper = mountDialog()

    await wrapper.find('[data-testid="move-library-select"]').setValue('2')
    await wrapper.find('[data-testid="move-confirm"]').trigger('click')

    expect(wrapper.emitted('confirm')).toEqual([[2, undefined]])
  })

  it('requires a folder choice for multi-folder libraries and passes it on confirm', async () => {
    const wrapper = mountDialog()

    await wrapper.find('[data-testid="move-library-select"]').setValue('3')
    expect(wrapper.find('[data-testid="move-folder-select"]').exists()).toBe(true)

    await wrapper.find('[data-testid="move-folder-select"]').setValue('32')
    await wrapper.find('[data-testid="move-confirm"]').trigger('click')

    expect(wrapper.emitted('confirm')).toEqual([[3, 32]])
  })

  it('disables confirm until a library is selected', () => {
    const wrapper = mountDialog()

    expect(wrapper.find('[data-testid="move-confirm"]').attributes('disabled')).toBeDefined()
  })

  it('emits cancel from the cancel button', async () => {
    const wrapper = mountDialog()

    await wrapper.find('[data-testid="move-cancel"]').trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('emits cancel from the backdrop', async () => {
    const wrapper = mountDialog()

    await wrapper.find('div.absolute.inset-0').trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('ignores backdrop and cancel clicks while a move is running', async () => {
    const wrapper = mount(MoveBooksDialog, {
      props: { open: true, count: 2, currentLibraryId: null, moving: true },
      global: { stubs: { Teleport: true } },
    })

    await wrapper.find('div.absolute.inset-0').trigger('click')
    await wrapper.find('[data-testid="move-cancel"]').trigger('click')

    expect(wrapper.emitted('cancel')).toBeUndefined()
  })

  it('fetches libraries when opened', () => {
    mountDialog()

    expect(fetchLibraries).toHaveBeenCalled()
  })
})
