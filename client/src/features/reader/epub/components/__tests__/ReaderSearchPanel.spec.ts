import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ReaderSearchPanel from '../ReaderSearchPanel.vue'

const globalStubs = {
  stubs: {
    Tooltip: { template: '<div><slot /></div>' },
    TooltipTrigger: { template: '<div><slot /></div>' },
    TooltipContent: { template: '<div><slot /></div>' },
  },
}

describe('ReaderSearchPanel', () => {
  it('debounces search input and emits trimmed query', async () => {
    vi.useFakeTimers()

    const wrapper = mount(ReaderSearchPanel, {
      props: {
        results: [],
        isSearching: false,
      },
      global: globalStubs,
    })

    await wrapper.get('input').setValue('  dragons  ')

    vi.advanceTimersByTime(599)
    expect(wrapper.emitted('search')).toBeUndefined()

    vi.advanceTimersByTime(1)
    expect(wrapper.emitted('search')?.[0]).toEqual(['dragons'])

    vi.useRealTimers()
  })

  it('emits clear when input becomes empty and when clear button is clicked', async () => {
    const wrapper = mount(ReaderSearchPanel, {
      props: {
        results: [],
        isSearching: false,
      },
      global: globalStubs,
    })

    await wrapper.get('input').setValue('abc')
    await wrapper.get('input').setValue('')

    expect(wrapper.emitted('clear')?.length).toBe(1)

    await wrapper.get('input').setValue('again')
    await wrapper.get('button[class*="w-6"]').trigger('click')

    expect(wrapper.emitted('clear')?.length).toBe(3)
  })

  it('emits navigate and close actions from UI interactions', async () => {
    const wrapper = mount(ReaderSearchPanel, {
      props: {
        initialQuery: 'dragons',
        isSearching: false,
        results: [
          {
            cfi: 'epubcfi(/6/4)',
            sectionTitle: 'Chapter 1',
            excerpt: { pre: 'A ', match: 'dragon', post: ' appears' },
          },
        ],
      },
      global: globalStubs,
    })

    await wrapper.get('li').trigger('click')
    expect(wrapper.emitted('navigate')?.[0]).toEqual(['epubcfi(/6/4)'])

    const overlays = wrapper.findAll('.flex-1')
    await overlays[overlays.length - 1]!.trigger('click')
    expect(wrapper.emitted('close')?.length).toBe(1)
  })
})
