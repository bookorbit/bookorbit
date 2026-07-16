import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'

import CoverSearchDrawer from './CoverSearchDrawer.vue'

vi.mock('@/components/ui/sheet', () => ({
  Sheet: defineComponent({
    name: 'MockSheet',
    props: ['open'],
    setup(_, { slots }) {
      return () => h('div', { 'data-testid': 'sheet' }, slots.default?.())
    },
  }),
  SheetContent: defineComponent({
    name: 'MockSheetContent',
    setup(_, { slots }) {
      return () => h('div', { 'data-testid': 'sheet-content' }, slots.default?.())
    },
  }),
  SheetHeader: defineComponent({
    name: 'MockSheetHeader',
    setup(_, { slots }) {
      return () => h('div', slots.default?.())
    },
  }),
  SheetTitle: defineComponent({
    name: 'MockSheetTitle',
    setup(_, { slots }) {
      return () => h('h2', slots.default?.())
    },
  }),
  SheetDescription: defineComponent({
    name: 'MockSheetDescription',
    setup(_, { slots }) {
      return () => h('p', slots.default?.())
    },
  }),
}))

vi.mock('@lucide/vue', () => ({
  Search: defineComponent({ name: 'MockSearch', setup: () => () => h('span', { 'data-testid': 'icon-search' }) }),
  Loader2: defineComponent({ name: 'MockLoader', setup: () => () => h('span', { 'data-testid': 'icon-loader' }) }),
  Image: defineComponent({ name: 'MockImageIcon', setup: () => () => h('span') }),
  Check: defineComponent({ name: 'MockCheck', setup: () => () => h('span', { 'data-testid': 'icon-check' }) }),
}))

type CoverResult = { url: string; previewUrl: string; sourceUrl: string; width: number; height: number; source: string }

function makeCoverResult(url: string, width = 600, height = 600): CoverResult {
  return { url, previewUrl: `${url}?thumb`, sourceUrl: url, width, height, source: 'iTunes' }
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

function mountDrawer(props: { open?: boolean; initialTitle?: string; initialAuthor?: string; isAudiobook?: boolean } = {}) {
  return mount(CoverSearchDrawer, {
    props: {
      open: props.open ?? true,
      initialTitle: props.initialTitle ?? 'Dune',
      initialAuthor: props.initialAuthor ?? 'Frank Herbert',
      isAudiobook: props.isAudiobook ?? false,
    },
  })
}

type DrawerVm = {
  performSearch: () => Promise<void>
  resultAspectClass: string
  searchResults: CoverResult[]
  handleSelect: (url: string) => void
  handleOpenChange: (val: boolean) => void
}

describe('CoverSearchDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('audiobook checkbox', () => {
    it('defaults checkbox to false for regular books', () => {
      const wrapper = mountDrawer({ isAudiobook: false })
      const checkbox = wrapper.find('input[type="checkbox"]')
      expect(checkbox.exists()).toBe(true)
      expect((checkbox.element as HTMLInputElement).checked).toBe(false)
    })

    it('defaults checkbox to true for audiobooks', () => {
      const wrapper = mountDrawer({ isAudiobook: true })
      const checkbox = wrapper.find('input[type="checkbox"]')
      expect((checkbox.element as HTMLInputElement).checked).toBe(true)
    })

    it('displays the audiobook label and square hint', () => {
      const wrapper = mountDrawer()
      expect(wrapper.text()).toContain('Audiobook covers')
      expect(wrapper.text()).toContain('square')
    })

    it('toggles isAudiobookSearch when checkbox is changed', async () => {
      const wrapper = mountDrawer({ isAudiobook: false })
      const checkbox = wrapper.find('input[type="checkbox"]')
      await checkbox.trigger('change')
      expect((checkbox.element as HTMLInputElement).checked).toBe(true)
    })

    it('can be toggled back to false', async () => {
      const wrapper = mountDrawer({ isAudiobook: true })
      const checkbox = wrapper.find('input[type="checkbox"]')
      await checkbox.trigger('change')
      expect((checkbox.element as HTMLInputElement).checked).toBe(false)
    })

    it('resets checkbox to prop value when drawer reopens', async () => {
      const wrapper = mountDrawer({ isAudiobook: false })
      const checkbox = wrapper.find('input[type="checkbox"]')

      await checkbox.trigger('change')
      expect((checkbox.element as HTMLInputElement).checked).toBe(true)

      await wrapper.setProps({ open: false })
      await wrapper.setProps({ open: true })
      expect((checkbox.element as HTMLInputElement).checked).toBe(false)
    })
  })

  describe('audiobookcovers source option', () => {
    it('is hidden from the source dropdown for regular books', () => {
      const wrapper = mountDrawer({ isAudiobook: false })
      const options = wrapper.findAll('option').map((option) => option.element.value)
      expect(options).not.toContain('audiobookcovers')
    })

    it('is shown in the source dropdown for audiobooks', () => {
      const wrapper = mountDrawer({ isAudiobook: true })
      const options = wrapper.findAll('option').map((option) => option.element.value)
      expect(options).toContain('audiobookcovers')
    })

    it('resets the selected provider away from audiobookcovers when audiobook is unchecked', async () => {
      const wrapper = mountDrawer({ isAudiobook: true })
      await wrapper.find('select').setValue('audiobookcovers')

      await wrapper.find('input[type="checkbox"]').trigger('change')

      const select = wrapper.find('select').element as HTMLSelectElement
      expect(select.value).toBe('duckduckgo')
    })
  })

  describe('aspect ratio', () => {
    it('uses portrait aspect class for regular books', () => {
      const wrapper = mountDrawer({ isAudiobook: false })
      const vm = wrapper.vm as unknown as DrawerVm
      expect(vm.resultAspectClass).toBe('aspect-[2/3]')
    })

    it('uses square aspect class for audiobooks', () => {
      const wrapper = mountDrawer({ isAudiobook: true })
      const vm = wrapper.vm as unknown as DrawerVm
      expect(vm.resultAspectClass).toBe('aspect-square')
    })

    it('toggling checkbox to audiobook updates resultAspectClass to square', async () => {
      const wrapper = mountDrawer({ isAudiobook: false })
      const vm = wrapper.vm as unknown as DrawerVm
      expect(vm.resultAspectClass).toBe('aspect-[2/3]')

      await wrapper.find('input[type="checkbox"]').trigger('change')
      expect(vm.resultAspectClass).toBe('aspect-square')
    })

    it('toggling checkbox back resets resultAspectClass to portrait', async () => {
      const wrapper = mountDrawer({ isAudiobook: true })
      const vm = wrapper.vm as unknown as DrawerVm
      expect(vm.resultAspectClass).toBe('aspect-square')

      await wrapper.find('input[type="checkbox"]').trigger('change')
      expect(vm.resultAspectClass).toBe('aspect-[2/3]')
    })

    it('resultAspectClass stays square when searching with audiobook results', async () => {
      const results = [makeCoverResult('https://img/a'), makeCoverResult('https://img/b')]
      vi.stubGlobal('fetch', () => Promise.resolve(okResponse(results)))

      const wrapper = mountDrawer({ isAudiobook: true })
      const vm = wrapper.vm as unknown as DrawerVm
      await vm.performSearch()
      await flushPromises()

      expect(vm.resultAspectClass).toBe('aspect-square')
      expect(vm.searchResults).toHaveLength(2)
    })
  })

  describe('API call parameters', () => {
    it('sends isAudiobook=false when checkbox is unchecked', async () => {
      let capturedUrl = ''
      vi.stubGlobal('fetch', (url: string) => {
        capturedUrl = url
        return Promise.resolve(okResponse([]))
      })

      const wrapper = mountDrawer({ isAudiobook: false })
      await (wrapper.vm as unknown as DrawerVm).performSearch()
      await flushPromises()

      expect(capturedUrl).toContain('isAudiobook=false')
    })

    it('sends isAudiobook=true when checkbox is checked', async () => {
      let capturedUrl = ''
      vi.stubGlobal('fetch', (url: string) => {
        capturedUrl = url
        return Promise.resolve(okResponse([]))
      })

      const wrapper = mountDrawer({ isAudiobook: true })
      await (wrapper.vm as unknown as DrawerVm).performSearch()
      await flushPromises()

      expect(capturedUrl).toContain('isAudiobook=true')
    })

    it('sends isAudiobook=true after toggling checkbox on a regular book', async () => {
      let capturedUrl = ''
      vi.stubGlobal('fetch', (url: string) => {
        capturedUrl = url
        return Promise.resolve(okResponse([]))
      })

      const wrapper = mountDrawer({ isAudiobook: false })
      await wrapper.find('input[type="checkbox"]').trigger('change')
      await (wrapper.vm as unknown as DrawerVm).performSearch()
      await flushPromises()

      expect(capturedUrl).toContain('isAudiobook=true')
    })

    it('sends isAudiobook=false after unchecking checkbox on an audiobook', async () => {
      let capturedUrl = ''
      vi.stubGlobal('fetch', (url: string) => {
        capturedUrl = url
        return Promise.resolve(okResponse([]))
      })

      const wrapper = mountDrawer({ isAudiobook: true })
      await wrapper.find('input[type="checkbox"]').trigger('change')
      await (wrapper.vm as unknown as DrawerVm).performSearch()
      await flushPromises()

      expect(capturedUrl).toContain('isAudiobook=false')
    })

    it('includes title and author in the search params', async () => {
      let capturedUrl = ''
      vi.stubGlobal('fetch', (url: string) => {
        capturedUrl = url
        return Promise.resolve(okResponse([]))
      })

      const wrapper = mountDrawer({ initialTitle: 'Dune', initialAuthor: 'Frank Herbert' })
      await (wrapper.vm as unknown as DrawerVm).performSearch()
      await flushPromises()

      expect(capturedUrl).toContain('title=Dune')
      expect(capturedUrl).toContain('author=Frank+Herbert')
    })

    it('includes the selected provider in the search params', async () => {
      let capturedUrl = ''
      vi.stubGlobal('fetch', (url: string) => {
        capturedUrl = url
        return Promise.resolve(okResponse([]))
      })

      const wrapper = mountDrawer()
      await wrapper.find('select').setValue('itunes')
      await (wrapper.vm as unknown as DrawerVm).performSearch()
      await flushPromises()

      expect(capturedUrl).toContain('provider=itunes')
    })

    it('does not call fetch when title is empty', async () => {
      const fetchMock = vi.fn<() => Promise<Response>>()
      vi.stubGlobal('fetch', fetchMock)

      const wrapper = mountDrawer({ initialTitle: '' })
      await (wrapper.vm as unknown as DrawerVm).performSearch()

      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('search results', () => {
    it('populates searchResults from API response', async () => {
      const results = [makeCoverResult('https://img/a'), makeCoverResult('https://img/b')]
      vi.stubGlobal('fetch', () => Promise.resolve(okResponse(results)))

      const wrapper = mountDrawer()
      const vm = wrapper.vm as unknown as DrawerVm
      await vm.performSearch()
      await flushPromises()

      expect(vm.searchResults).toHaveLength(2)
      expect(vm.searchResults[0]?.url).toBe('https://img/a')
    })

    it('clears previous results before a new search', async () => {
      const first = [makeCoverResult('https://img/a')]
      const second = [makeCoverResult('https://img/b'), makeCoverResult('https://img/c')]
      const fetchStub = vi.fn<() => Promise<Response>>()
      fetchStub.mockResolvedValueOnce(okResponse(first)).mockResolvedValueOnce(okResponse(second))
      vi.stubGlobal('fetch', fetchStub)

      const wrapper = mountDrawer()
      const vm = wrapper.vm as unknown as DrawerVm

      await vm.performSearch()
      await flushPromises()
      expect(vm.searchResults).toHaveLength(1)

      await vm.performSearch()
      await flushPromises()
      expect(vm.searchResults).toHaveLength(2)
    })

    it('leaves searchResults empty and logs on fetch failure', async () => {
      vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 500 })))
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

      const wrapper = mountDrawer()
      const vm = wrapper.vm as unknown as DrawerVm
      await vm.performSearch()
      await flushPromises()

      expect(vm.searchResults).toHaveLength(0)
      expect(consoleSpy).toHaveBeenCalled()
    })

    it('emits select and closes drawer when handleSelect is called', async () => {
      const results = [makeCoverResult('https://img/a')]
      vi.stubGlobal('fetch', () => Promise.resolve(okResponse(results)))

      const wrapper = mountDrawer()
      const vm = wrapper.vm as unknown as DrawerVm
      await vm.performSearch()
      await flushPromises()

      vm.handleSelect('https://img/a')

      expect(wrapper.emitted('select')).toEqual([['https://img/a']])
      expect(wrapper.emitted('update:open')).toEqual([[false]])
    })

    it('emits update:open when handleOpenChange is called with false', () => {
      const wrapper = mountDrawer()
      const vm = wrapper.vm as unknown as DrawerVm
      vm.handleOpenChange(false)
      expect(wrapper.emitted('update:open')).toEqual([[false]])
    })
  })
})
