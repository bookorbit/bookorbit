import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookSelectionPayload, Collection } from '@bookorbit/types'
import AddToCollectionSheet from '../AddToCollectionSheet.vue'

const {
  toastSuccess,
  toastError,
  fetchCollectionsWithMembershipMock,
  createCollectionMock,
  addBooksToCollectionMock,
  removeBooksFromCollectionMock,
} = vi.hoisted(() => ({
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
  fetchCollectionsWithMembershipMock: vi.fn<(selectionPayload: BookSelectionPayload) => Promise<Collection[]>>(),
  createCollectionMock: vi.fn<(name: string, icon: string) => Promise<Collection>>(),
  addBooksToCollectionMock: vi.fn<(collectionId: number, selectionPayload: BookSelectionPayload) => Promise<Collection>>(),
  removeBooksFromCollectionMock: vi.fn<(collectionId: number, selectionPayload: BookSelectionPayload) => Promise<Collection>>(),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
  },
}))

vi.mock('@/features/collection/composables/useCollections', () => ({
  useCollections: () => ({
    fetchCollectionsWithMembership: fetchCollectionsWithMembershipMock,
    createCollection: createCollectionMock,
    addBooksToCollection: addBooksToCollectionMock,
    removeBooksFromCollection: removeBooksFromCollectionMock,
  }),
}))

vi.mock('@/composables/useVirtualKeyboard', () => ({
  useVirtualKeyboard: () => ({
    keyboardHeight: { value: 0 },
  }),
}))

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: 10,
    name: 'Favorites',
    icon: 'FolderOpen',
    description: null,
    syncToKobo: false,
    displayOrder: 0,
    bookCount: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const globalStubs = {
  stubs: {
    Sheet: { template: '<div><slot /></div>' },
    SheetContent: { template: '<div><slot /></div>' },
    SheetHeader: { template: '<div><slot /></div>' },
    SheetTitle: { template: '<div><slot /></div>' },
    Button: {
      props: ['disabled', 'variant', 'size'],
      emits: ['click'],
      template: '<button :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>',
    },
    Input: {
      props: ['modelValue', 'placeholder'],
      emits: ['update:modelValue', 'keydown'],
      template:
        '<input :value="modelValue" :placeholder="placeholder" @input="$emit(\'update:modelValue\', $event.target.value)" @keydown="$emit(\'keydown\', $event)" />',
    },
    IconPicker: {
      emits: ['update:modelValue'],
      template: '<button data-testid="icon-picker" @click="$emit(\'update:modelValue\', \'FolderOpen\')">Pick icon</button>',
    },
  },
}

function mountSheet(props: { open?: boolean; selectionPayload?: BookSelectionPayload; selectedCount?: number } = {}) {
  return mount(AddToCollectionSheet, {
    props: {
      open: props.open ?? true,
      selectionPayload: props.selectionPayload ?? { bookIds: [1] },
      selectedCount: props.selectedCount,
    },
    global: globalStubs,
  })
}

function findButtonByText(wrapper: ReturnType<typeof mountSheet>, text: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().includes(text))
  expect(button).toBeDefined()
  return button!
}

describe('AddToCollectionSheet', () => {
  beforeEach(() => {
    toastSuccess.mockReset()
    toastError.mockReset()
    fetchCollectionsWithMembershipMock.mockReset()
    createCollectionMock.mockReset()
    addBooksToCollectionMock.mockReset()
    removeBooksFromCollectionMock.mockReset()
  })

  it('loads membership rows when opened', async () => {
    fetchCollectionsWithMembershipMock.mockResolvedValue([makeCollection({ id: 1, name: 'Read soon', memberCount: 0 })])

    const wrapper = mountSheet()
    await flushPromises()

    expect(fetchCollectionsWithMembershipMock).toHaveBeenCalledWith({ bookIds: [1] })
    expect(wrapper.text()).toContain('Read soon')
  })

  it('shows an error toast when collection loading fails', async () => {
    fetchCollectionsWithMembershipMock.mockRejectedValue(new Error('network error'))

    mountSheet()
    await flushPromises()

    expect(toastError).toHaveBeenCalledWith('Failed to load collections')
  })

  it('adds books when clicking a non-member collection and emits done on close', async () => {
    fetchCollectionsWithMembershipMock.mockResolvedValue([makeCollection({ id: 2, name: 'Queue', memberCount: 0, bookCount: 4 })])
    addBooksToCollectionMock.mockResolvedValue(makeCollection({ id: 2, name: 'Queue' }))

    const wrapper = mountSheet()
    await flushPromises()

    await findButtonByText(wrapper, 'Queue').trigger('click')
    await flushPromises()

    expect(addBooksToCollectionMock).toHaveBeenCalledWith(2, { bookIds: [1] })
    expect(removeBooksFromCollectionMock).not.toHaveBeenCalled()
    expect(toastSuccess).toHaveBeenCalledWith('Added one book to "Queue"')

    await findButtonByText(wrapper, 'Done').trigger('click')

    expect(wrapper.emitted('done')).toHaveLength(1)
    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })

  it('removes books when clicking a full-membership collection and emits done on close', async () => {
    fetchCollectionsWithMembershipMock.mockResolvedValue([makeCollection({ id: 3, name: 'Finished', memberCount: 1, bookCount: 8 })])
    removeBooksFromCollectionMock.mockResolvedValue(makeCollection({ id: 3, name: 'Finished' }))

    const wrapper = mountSheet()
    await flushPromises()

    await findButtonByText(wrapper, 'Finished').trigger('click')
    await flushPromises()

    expect(removeBooksFromCollectionMock).toHaveBeenCalledWith(3, { bookIds: [1] })
    expect(addBooksToCollectionMock).not.toHaveBeenCalled()
    expect(toastSuccess).toHaveBeenCalledWith('Removed one book from "Finished"')

    await findButtonByText(wrapper, 'Done').trigger('click')

    expect(wrapper.emitted('done')).toHaveLength(1)
    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })

  it('does not emit done when removal fails', async () => {
    fetchCollectionsWithMembershipMock.mockResolvedValue([makeCollection({ id: 4, name: 'Kobo', memberCount: 1 })])
    removeBooksFromCollectionMock.mockRejectedValue(new Error('delete failed'))

    const wrapper = mountSheet()
    await flushPromises()

    await findButtonByText(wrapper, 'Kobo').trigger('click')
    await flushPromises()

    expect(toastError).toHaveBeenCalledWith('Failed to remove from collection')

    await findButtonByText(wrapper, 'Done').trigger('click')

    expect(wrapper.emitted('done')).toBeUndefined()
    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })

  it('creates a collection and adds selected books', async () => {
    fetchCollectionsWithMembershipMock.mockResolvedValue([])
    createCollectionMock.mockResolvedValue(makeCollection({ id: 12, name: 'New Shelf', bookCount: 0 }))
    addBooksToCollectionMock.mockResolvedValue(makeCollection({ id: 12, name: 'New Shelf', bookCount: 1 }))

    const wrapper = mountSheet()
    await flushPromises()

    const input = wrapper.get('input')
    await input.setValue('New Shelf')
    await wrapper.get('[data-testid="icon-picker"]').trigger('click')

    await findButtonByText(wrapper, 'Create').trigger('click')
    await flushPromises()

    expect(createCollectionMock).toHaveBeenCalledWith('New Shelf', 'FolderOpen')
    expect(addBooksToCollectionMock).toHaveBeenCalledWith(12, { bookIds: [1] })

    await findButtonByText(wrapper, 'Done').trigger('click')
    expect(wrapper.emitted('done')).toHaveLength(1)
  })

  it('uses query-scoped payloads and selectedCount for all-matching selections', async () => {
    const selectionPayload: BookSelectionPayload = { query: { libraryId: 5, q: 'dune', sort: [{ field: 'title', dir: 'asc' }] } }
    fetchCollectionsWithMembershipMock.mockResolvedValue([makeCollection({ id: 20, name: 'All Dune', memberCount: 100, bookCount: 500 })])
    addBooksToCollectionMock.mockResolvedValue(makeCollection({ id: 20, name: 'All Dune', bookCount: 1833 }))

    const wrapper = mountSheet({ selectionPayload, selectedCount: 1833 })
    await flushPromises()

    expect(fetchCollectionsWithMembershipMock).toHaveBeenCalledWith(selectionPayload)
    expect(wrapper.text()).toContain('1833 books selected')
    expect(wrapper.text()).toContain('100 of 1833 in this collection')

    await findButtonByText(wrapper, 'All Dune').trigger('click')
    await flushPromises()

    expect(addBooksToCollectionMock).toHaveBeenCalledWith(20, selectionPayload)
    expect(toastSuccess).toHaveBeenCalledWith('Added 1733 new books to "All Dune" (100 already there)')
  })

  it('does not emit done when no membership changes occurred', async () => {
    fetchCollectionsWithMembershipMock.mockResolvedValue([makeCollection({ id: 14, name: 'No-op', memberCount: 0 })])

    const wrapper = mountSheet()
    await flushPromises()

    await findButtonByText(wrapper, 'Done').trigger('click')

    expect(wrapper.emitted('done')).toBeUndefined()
    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })
})
