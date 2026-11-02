import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import type { Collection } from '@bookorbit/types'
import CreateCollectionDialog from '../CreateCollectionDialog.vue'

const mockState = vi.hoisted(() => ({
  createCollection: vi.fn<(name: string, icon: string, description?: string, isPublic?: boolean) => Promise<Collection>>(),
  push: vi.fn<() => void>(),
}))

vi.mock('../../composables/useCollections', () => ({
  useCollections: () => ({ createCollection: mockState.createCollection }),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockState.push }),
}))

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: 4,
    userId: 7,
    name: 'Favorites',
    icon: 'FolderOpen',
    description: null,
    isPublic: false,
    isOwner: true,
    syncToKobo: false,
    displayOrder: 0,
    bookCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const IconPickerStub = defineComponent({
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () =>
      h('input', {
        class: 'icon-picker',
        value: props.modelValue,
        onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value),
      })
  },
})

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(CreateCollectionDialog, {
    props: { open: true, ...props },
    global: { stubs: { Teleport: true, IconPicker: IconPickerStub } },
  })
}

async function fillRequiredFields(wrapper: ReturnType<typeof mountDialog>, name: string): Promise<void> {
  await wrapper.find('input[type="text"]').setValue(name)
  await wrapper.find('.icon-picker').setValue('FolderOpen')
}

describe('CreateCollectionDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.createCollection.mockResolvedValue(makeCollection())
  })

  it('creates a private collection and routes to it', async () => {
    const wrapper = mountDialog()

    await fillRequiredFields(wrapper, 'Favorites')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mockState.createCollection).toHaveBeenCalledWith('Favorites', 'FolderOpen', undefined, undefined)
    expect(mockState.push).toHaveBeenCalledWith({ name: 'collection', params: { id: 4 } })
  })

  it('does not submit without a name', async () => {
    const wrapper = mountDialog()

    await wrapper.find('.icon-picker').setValue('FolderOpen')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mockState.createCollection).not.toHaveBeenCalled()
  })
})
