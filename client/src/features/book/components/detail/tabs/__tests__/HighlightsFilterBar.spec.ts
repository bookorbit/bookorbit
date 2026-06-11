import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import HighlightsFilterBar from '../HighlightsFilterBar.vue'

function makeProps(overrides = {}) {
  return {
    activeColors: [] as string[],
    chapters: ['Chapter 1', 'Chapter 2'],
    selectedChapter: undefined as string | undefined,
    dateFrom: undefined as string | undefined,
    dateTo: undefined as string | undefined,
    ...overrides,
  }
}

describe('HighlightsFilterBar', () => {
  it('renders search input', () => {
    const wrapper = mount(HighlightsFilterBar, { props: makeProps() })
    const input = wrapper.find('input[type="text"]')
    expect(input.exists()).toBe(true)
    expect(input.attributes('placeholder')).toBe('Search highlights...')
  })

  it('renders color filter buttons', () => {
    const wrapper = mount(HighlightsFilterBar, { props: makeProps() })
    const colorButtons = wrapper.findAll('button[title]')
    expect(colorButtons.length).toBe(10)
    expect(colorButtons.map((button) => button.attributes('title'))).toEqual([
      'Yellow',
      'Green',
      'Blue',
      'Pink',
      'Orange',
      'Red',
      'Olive',
      'Cyan',
      'Purple',
      'Gray',
    ])
  })

  it('emits toggleColor when a color button is clicked', async () => {
    const wrapper = mount(HighlightsFilterBar, { props: makeProps() })
    const yellowBtn = wrapper.find('button[title="Yellow"]')
    await yellowBtn.trigger('click')
    expect(wrapper.emitted('toggleColor')).toBeTruthy()
    expect(wrapper.emitted('toggleColor')![0]).toEqual(['#FACC15'])
  })

  it('highlights active color buttons', () => {
    const wrapper = mount(HighlightsFilterBar, {
      props: makeProps({ activeColors: ['#FACC15'] }),
    })
    const yellowBtn = wrapper.find('button[title="Yellow"]')
    expect(yellowBtn.classes()).toContain('border-foreground')
  })

  it('renders chapter dropdown when chapters exist', () => {
    const wrapper = mount(HighlightsFilterBar, { props: makeProps() })
    const select = wrapper.find('select')
    expect(select.exists()).toBe(true)
    const options = select.findAll('option')
    expect(options.length).toBe(3)
    expect(options[0]?.text()).toBe('All chapters')
  })

  it('does not render chapter dropdown when no chapters', () => {
    const wrapper = mount(HighlightsFilterBar, {
      props: makeProps({ chapters: [] }),
    })
    expect(wrapper.find('select').exists()).toBe(false)
  })

  it('emits chapterChange when chapter is selected', async () => {
    const wrapper = mount(HighlightsFilterBar, { props: makeProps() })
    const select = wrapper.find('select')
    await select.setValue('Chapter 1')
    expect(wrapper.emitted('chapterChange')).toBeTruthy()
    expect(wrapper.emitted('chapterChange')![0]).toEqual(['Chapter 1'])
  })

  it('renders date range inputs', () => {
    const wrapper = mount(HighlightsFilterBar, { props: makeProps() })
    const dateInputs = wrapper.findAll('input[type="date"]')
    expect(dateInputs.length).toBe(2)
  })

  it('emits dateRangeChange when date from changes', async () => {
    const wrapper = mount(HighlightsFilterBar, { props: makeProps() })
    const dateInputs = wrapper.findAll('input[type="date"]')
    await dateInputs[0]?.setValue('2026-01-01')
    expect(wrapper.emitted('dateRangeChange')).toBeTruthy()
    expect(wrapper.emitted('dateRangeChange')![0]).toEqual(['2026-01-01', undefined])
  })

  it('emits search with debounce on input', async () => {
    vi.useFakeTimers()
    const wrapper = mount(HighlightsFilterBar, { props: makeProps() })
    const input = wrapper.find('input[type="text"]')

    await input.setValue('test')
    await input.trigger('input')
    expect(wrapper.emitted('search')).toBeFalsy()

    vi.advanceTimersByTime(300)
    expect(wrapper.emitted('search')).toBeTruthy()

    vi.useRealTimers()
  })

  it('shows clear button when search has value and emits on click', async () => {
    vi.useFakeTimers()
    const wrapper = mount(HighlightsFilterBar, { props: makeProps() })
    const input = wrapper.find('input[type="text"]')

    await input.setValue('test')
    const clearBtn = wrapper.findAll('button').find((b) => !b.attributes('title'))
    expect(clearBtn).toBeTruthy()

    vi.useRealTimers()
  })
})
