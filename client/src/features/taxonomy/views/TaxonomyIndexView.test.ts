import { flushPromises, shallowMount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { TaxonomyPage } from '@bookorbit/types'
import TaxonomyIndexView from './TaxonomyIndexView.vue'

const mocks = vi.hoisted(() => ({
  fetchTaxonomyPage: vi.fn<(...args: unknown[]) => Promise<TaxonomyPage>>(),
  route: { query: {} as Record<string, unknown> },
  push: vi.fn<(to: unknown) => Promise<void>>(),
  replace: vi.fn<(to: unknown) => Promise<void>>(),
}))

vi.mock('../api/taxonomy', () => ({ fetchTaxonomyPage: mocks.fetchTaxonomyPage }))
vi.mock('vue-router', () => ({
  useRoute: () => mocks.route,
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}))
vi.mock('@/features/book/composables/useScrollRestoreOnActivate', () => ({ useScrollRestoreOnActivate: vi.fn<() => void>() }))
vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({ libraries: ref([{ id: 4, name: 'Novels', bookCount: 12 }]), fetchLibraries: vi.fn<() => Promise<void>>() }),
}))

const VIEW_MODE_KEY = 'bookorbit:taxonomyIndexView'
const EMPTY_PAGE: TaxonomyPage = { items: [], total: 0, page: 0, size: 50, totals: { genre: 0, tag: 0 } }

function mountIndex(kind: 'genre' | 'tag' = 'genre') {
  return shallowMount(TaxonomyIndexView, {
    props: { kind },
    global: { stubs: { BrowseHeader: { template: '<div><slot name="facts" /><slot name="bar" /></div>' } } },
  })
}

function listCalls() {
  return mocks.fetchTaxonomyPage.mock.calls.filter(([, params]) => (params as { size: number }).size === 50)
}

function topCalls() {
  return mocks.fetchTaxonomyPage.mock.calls.filter(([, params]) => (params as { size: number }).size !== 50)
}

describe('TaxonomyIndexView', () => {
  beforeEach(() => {
    mocks.fetchTaxonomyPage.mockReset().mockResolvedValue(EMPTY_PAGE)
    mocks.push.mockReset()
    mocks.replace.mockReset()
    mocks.route.query = {}
    localStorage.removeItem(VIEW_MODE_KEY)
  })

  afterEach(() => {
    localStorage.removeItem(VIEW_MODE_KEY)
  })

  it('opens the list biggest first and loads it once', async () => {
    mountIndex()
    await flushPromises()

    expect(listCalls()).toEqual([['genre', expect.objectContaining({ page: 0, sort: 'bookCount', order: 'desc', libraryId: null })]])
    expect(topCalls()).toEqual([])
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it('restores search, sort and library from the address with a single load', async () => {
    mocks.route.query = { q: 'fan', sort: 'name', order: 'desc', libraryId: '4' }
    mountIndex('tag')
    await flushPromises()

    expect(listCalls()).toEqual([['tag', expect.objectContaining({ q: 'fan', sort: 'name', order: 'desc', libraryId: 4 })]])
  })

  it('ignores a sort or library the address cannot mean', async () => {
    mocks.route.query = { sort: 'shoeSize', order: 'sideways', libraryId: '-3' }
    mountIndex()
    await flushPromises()

    expect(listCalls()).toEqual([['genre', expect.objectContaining({ sort: 'bookCount', order: 'desc', libraryId: null })]])
  })

  it('opens the remembered cloud alphabetically, with the biggest names on top', async () => {
    localStorage.setItem(VIEW_MODE_KEY, JSON.stringify('cloud'))
    mountIndex()
    await flushPromises()

    expect(listCalls()).toEqual([['genre', expect.objectContaining({ sort: 'name', order: 'asc' })]])
    expect(topCalls()).toHaveLength(1)
  })

  it('moves to A to Z when the cloud is picked while sorted by books, and remembers the choice', async () => {
    const wrapper = mountIndex()
    await flushPromises()
    mocks.fetchTaxonomyPage.mockClear()

    wrapper.findComponent({ name: 'TaxonomyViewToggle' }).vm.$emit('update:modelValue', 'cloud')
    await flushPromises()

    expect(listCalls()).toEqual([['genre', expect.objectContaining({ sort: 'name', order: 'asc' })]])
    expect(topCalls()).toHaveLength(1)
    expect(mocks.replace).toHaveBeenLastCalledWith({
      name: 'genres',
      query: { q: undefined, sort: undefined, order: undefined, libraryId: undefined },
    })
    expect(localStorage.getItem(VIEW_MODE_KEY)).toContain('cloud')
  })

  it('keeps the chosen library when switching between genres and tags', async () => {
    mocks.route.query = { libraryId: '4' }
    const wrapper = mountIndex()
    await flushPromises()

    wrapper.findComponent({ name: 'TaxonomyKindSwitch' }).vm.$emit('select', 'tag')

    expect(mocks.push).toHaveBeenCalledWith({ name: 'tags', query: { libraryId: '4' } })
  })
})
