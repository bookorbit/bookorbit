import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ReaderSearchPanel from '../ReaderSearchPanel.vue'
import { MIN_SEARCH_QUERY_LENGTH } from '../../composables/useSearch'

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

  it('requires minimum query length before searching', async () => {
    vi.useFakeTimers()

    const wrapper = mount(ReaderSearchPanel, {
      props: {
        results: [],
        isSearching: false,
      },
      global: globalStubs,
    })

    await wrapper.get('input').setValue('x'.repeat(MIN_SEARCH_QUERY_LENGTH - 1))

    vi.advanceTimersByTime(700)
    expect(wrapper.emitted('search')).toBeUndefined()
    expect(wrapper.emitted('clear')?.length).toBe(1)
    expect(wrapper.text()).toContain(`Type at least ${MIN_SEARCH_QUERY_LENGTH} characters`)

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

    const dismissOverlay = wrapper.find('.fixed.inset-0.z-50.flex.justify-end > .flex-1')
    expect(dismissOverlay.exists()).toBe(true)
    await dismissOverlay.trigger('click')
    expect(wrapper.emitted('close')?.length).toBe(1)
  })

  it('does not emit navigate when navigation is locked', async () => {
    const wrapper = mount(ReaderSearchPanel, {
      props: {
        initialQuery: 'dragons',
        isSearching: false,
        navigationLocked: true,
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
    expect(wrapper.emitted('navigate')).toBeUndefined()
  })
})
