import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { Collection } from '@bookorbit/types'

const fetchPodcastCollectionMembership = vi.fn<(podcastId: number) => Promise<Collection[]>>()
const addPodcastsToCollection = vi.fn<(id: number, ids: number[]) => Promise<void>>()
const createCollection = vi.fn<(name: string, icon: string, description?: string, mediaType?: string) => Promise<Collection>>()

const removePodcastsFromCollection = vi.fn<(id: number, ids: number[]) => Promise<void>>()
const refreshCollections = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)

vi.mock('@/features/collection/composables/useCollections', () => ({
  useCollections: () => ({
    fetchPodcastCollectionMembership,
    addPodcastsToCollection,
    removePodcastsFromCollection,
    createCollection,
    refreshCollections,
  }),
}))

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn<() => void>(), toastError: vi.fn<() => void>() }))
vi.mock('vue-sonner', () => ({ toast: { success: toastSuccess, error: toastError } }))

vi.mock('@/i18n/formatters', () => ({ formatNumber: (value: number) => String(value) }))

import AddShowToCollectionSheet from './AddShowToCollectionSheet.vue'
import { sheetStubs } from '../test/stubs'

function makeCollection(id: number, name: string): Collection {
  return {
    id,
    userId: 7,
    mediaType: 'podcasts',
    name,
    icon: 'FolderOpen',
    description: null,
    isPublic: false,
    isOwner: true,
    syncToKobo: false,
    displayOrder: 0,
    bookCount: 0,
    podcastCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function mountSheet() {
  return mount(AddShowToCollectionSheet, {
    props: { open: false, show: { id: 7, title: 'Lightspeed' } },
    global: { stubs: { ...sheetStubs(), AppIcon: true } },
  })
}

async function open(wrapper: ReturnType<typeof mountSheet>) {
  await wrapper.setProps({ open: true })
  await flushPromises()
}

/** Rows are named by their collection, so a test never has to count buttons to find one. */
function collectionRow(wrapper: ReturnType<typeof mountSheet>, name: string) {
  return wrapper.findAll('button').find((button) => button.text().includes(name))!
}

describe('AddShowToCollectionSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchPodcastCollectionMembership.mockResolvedValue([makeCollection(1, 'Sci-fi'), makeCollection(2, 'News')])
    addPodcastsToCollection.mockResolvedValue(undefined)
    removePodcastsFromCollection.mockResolvedValue(undefined)
    createCollection.mockResolvedValue(makeCollection(3, 'Created'))
  })

  it('lists only podcast collections once opened', async () => {
    const wrapper = mountSheet()
    await open(wrapper)

    expect(fetchPodcastCollectionMembership).toHaveBeenCalledWith(7)
    expect(wrapper.text()).toContain('Sci-fi')
    expect(wrapper.text()).toContain('News')
  })

  it('adds the show to the chosen collection', async () => {
    const wrapper = mountSheet()
    await open(wrapper)

    await collectionRow(wrapper, 'Sci-fi').trigger('click')
    await flushPromises()

    expect(addPodcastsToCollection).toHaveBeenCalledWith(1, [7])
    expect(toastSuccess).toHaveBeenCalled()
  })

  it('shows membership as a labelled state rather than a dead disabled row', async () => {
    fetchPodcastCollectionMembership.mockResolvedValue([{ ...makeCollection(1, 'Sci-fi'), memberCount: 1 }, makeCollection(2, 'News')])
    const wrapper = mountSheet()
    await open(wrapper)

    expect(wrapper.text()).toContain('In this collection')
    expect(collectionRow(wrapper, 'Sci-fi').attributes('disabled')).toBeUndefined()
  })

  it('reports a failed add without marking the show as a member', async () => {
    addPodcastsToCollection.mockRejectedValue(new Error('boom'))
    const wrapper = mountSheet()
    await open(wrapper)

    await collectionRow(wrapper, 'Sci-fi').trigger('click')
    await flushPromises()

    expect(toastError).toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('In this collection')
  })

  it('creates a podcast collection and adds the show to it in one step', async () => {
    const wrapper = mountSheet()
    await open(wrapper)

    await wrapper.get('input[aria-label="New collection name"]').setValue('Space stuff')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Create')!
      .trigger('click')
    await flushPromises()

    expect(createCollection).toHaveBeenCalledWith('Space stuff', 'FolderOpen', undefined, 'podcasts')
    expect(addPodcastsToCollection).toHaveBeenCalledWith(3, [7])
  })

  it('offers to create one when the user has no podcast collections yet', async () => {
    fetchPodcastCollectionMembership.mockResolvedValue([])
    const wrapper = mountSheet()
    await open(wrapper)

    expect(wrapper.text()).toContain('No podcast collections yet')
    expect(wrapper.find('input[aria-label="New collection name"]').exists()).toBe(true)
  })

  it('announces the membership load instead of showing an empty list while it runs', async () => {
    let resolveMembership: ((rows: Collection[]) => void) | undefined
    fetchPodcastCollectionMembership.mockReturnValue(
      new Promise<Collection[]>((resolve) => {
        resolveMembership = resolve
      }),
    )
    const wrapper = mountSheet()
    await wrapper.setProps({ open: true })
    await flushPromises()

    expect(wrapper.find('[role="status"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('No podcast collections yet')

    resolveMembership!([makeCollection(1, 'Sci-fi')])
    await flushPromises()

    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })

  it('removes the show when its collection is clicked again, rather than dead-ending on a disabled row', async () => {
    fetchPodcastCollectionMembership.mockResolvedValue([{ ...makeCollection(1, 'Sci-fi'), memberCount: 1 }])
    const wrapper = mountSheet()
    await open(wrapper)

    await collectionRow(wrapper, 'Sci-fi').trigger('click')
    await flushPromises()

    expect(removePodcastsFromCollection).toHaveBeenCalledWith(1, [7])
    expect(wrapper.text()).not.toContain('In this collection')
  })

  it('refreshes the collection list so the sidebar count follows a membership change', async () => {
    const wrapper = mountSheet()
    await open(wrapper)

    await collectionRow(wrapper, 'Sci-fi').trigger('click')
    await flushPromises()

    expect(refreshCollections).toHaveBeenCalled()
  })
})
