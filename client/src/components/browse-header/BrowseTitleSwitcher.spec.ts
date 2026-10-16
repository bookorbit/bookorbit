import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import BrowseTitleSwitcher from './BrowseTitleSwitcher.vue'

const mocks = vi.hoisted(() => ({
  push: vi.fn<(to: unknown) => Promise<void>>(),
}))

vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({
    libraries: ref([
      { id: 1, name: 'Novels', type: 'books', icon: null, bookCount: 454 },
      { id: 2, name: 'Audiobooks', type: 'books', icon: null, bookCount: 4 },
      { id: 9, name: 'Shows', type: 'podcasts', icon: null, podcastCount: 3 },
    ]),
  }),
}))
vi.mock('@/features/smart-scope/composables/useSmartScopes', () => ({
  useSmartScopes: () => ({ bookScopes: ref([{ id: 2, name: 'Kobo', icon: null, mediaType: 'books', bookCount: 172 }]) }),
}))
vi.mock('@/features/collection/composables/useCollections', () => ({
  useCollections: () => ({ bookCollections: ref([{ id: 8, name: 'Autumn Reads', icon: null, mediaType: 'books', bookCount: 2 }]) }),
}))

const passthrough = { template: '<div><slot /></div>' }
const stubs = {
  Popover: passthrough,
  PopoverTrigger: passthrough,
  PopoverContent: { template: '<div data-testid="popover"><slot /></div>' },
  AppIcon: true,
}

function mountSwitcher() {
  return mount(BrowseTitleSwitcher, { props: { place: { kind: 'library', id: 1 }, title: 'Novels' }, global: { stubs } })
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('BrowseTitleSwitcher', () => {
  it('lists the book libraries, scopes and collections, with the current place marked', () => {
    const wrapper = mountSwitcher()

    const items = wrapper.findAll('[data-switch-item]')
    expect(items.map((item) => item.findAll('span').map((span) => span.text()))).toEqual([
      ['Novels', '454'],
      ['Audiobooks', '4'],
      ['Kobo', '172'],
      ['Autumn Reads', '2'],
    ])
    expect(items[0]!.attributes('aria-current')).toBe('page')
    expect(wrapper.text()).not.toContain('Shows')
  })

  it('narrows the list as the reader types', async () => {
    const wrapper = mountSwitcher()

    await wrapper.get('input').setValue('ko')
    expect(wrapper.findAll('[data-switch-item]').map((item) => item.text())).toEqual([expect.stringContaining('Kobo')])
  })

  it('goes to the picked place and stays put on the current one', async () => {
    const wrapper = mountSwitcher()

    const items = wrapper.findAll('[data-switch-item]')
    await items[0]!.trigger('click')
    expect(mocks.push).not.toHaveBeenCalled()

    await items[3]!.trigger('click')
    await flushPromises()
    expect(mocks.push).toHaveBeenCalledWith({ name: 'collection', params: { id: 8 } })
  })

  it('names the place it switches from', () => {
    expect(mountSwitcher().get('button').attributes('aria-label')).toBe('Switch from Novels')
  })
})
