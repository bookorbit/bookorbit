import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Collection, CoverAspectRatio } from '@bookorbit/types'
import EditCollectionDialog from '../EditCollectionDialog.vue'

const mockState = vi.hoisted(() => ({
  updateCollection: vi.fn<(...args: unknown[]) => Promise<void>>(),
  deleteCollection: vi.fn<(id: number) => Promise<void>>(),
}))

vi.mock('../../composables/useCollections', () => ({
  useCollections: () => ({ updateCollection: mockState.updateCollection, deleteCollection: mockState.deleteCollection }),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn<() => void>() }),
}))

const TALL_SHAPE = 'input[name="collection-grid-shape"][value="2/3"]'
const SQUARE_SHAPE = 'input[name="collection-grid-shape"][value="1/1"]'

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: 4,
    userId: 7,
    name: 'Commute',
    icon: 'Headphones',
    description: null,
    isPublic: false,
    coverAspectRatio: '2/3',
    isOwner: true,
    syncToKobo: false,
    displayOrder: 0,
    bookCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

async function openDialog(coverAspectRatio: CoverAspectRatio) {
  const wrapper = mount(EditCollectionDialog, {
    props: { open: false, collection: makeCollection({ coverAspectRatio }) },
    global: { stubs: { Teleport: true, IconPicker: true } },
  })
  await wrapper.setProps({ open: true })
  return wrapper
}

describe('EditCollectionDialog grid shape (issue #1926)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.updateCollection.mockResolvedValue(undefined)
  })

  it('opens on the collection shape and saves a newly picked one', async () => {
    const wrapper = await openDialog('2/3')
    expect((wrapper.find(TALL_SHAPE).element as HTMLInputElement).checked).toBe(true)

    await wrapper.find(SQUARE_SHAPE).setValue(true)
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mockState.updateCollection).toHaveBeenCalledWith(4, 'Commute', 'Headphones', false, false, '1/1')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('keeps a square collection square when only other fields change', async () => {
    const wrapper = await openDialog('1/1')
    expect((wrapper.find(SQUARE_SHAPE).element as HTMLInputElement).checked).toBe(true)

    await wrapper.find('input[type="text"]').setValue('Listening')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mockState.updateCollection).toHaveBeenCalledWith(4, 'Listening', 'Headphones', false, false, '1/1')
  })

  it('labels the shape choices with the section heading', async () => {
    const wrapper = await openDialog('2/3')

    const fieldset = wrapper.find('fieldset')
    const heading = wrapper.find(`#${fieldset.attributes('aria-labelledby')}`)
    expect(heading.exists()).toBe(true)
    expect(wrapper.findAll('input[name="collection-grid-shape"]')).toHaveLength(2)
  })
})
