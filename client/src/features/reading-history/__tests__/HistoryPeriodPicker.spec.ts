import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import HistoryPeriodPicker from '../components/HistoryPeriodPicker.vue'

const years = [
  { year: 2026, reads: 12 },
  { year: 2025, reads: 9 },
  { year: 1998, reads: 3 },
]

function mountPicker(year: number | null = 2026) {
  return mount(HistoryPeriodPicker, {
    props: { years, year, quarter: null, currentYear: 2026 },
  })
}

describe('HistoryPeriodPicker', () => {
  it('keeps All time outside the scrolling years and emits it as a period', async () => {
    const wrapper = mountPicker()
    const scroller = wrapper.get('[data-year-scroller]')

    expect(scroller.text()).not.toContain('All time')
    const allTime = wrapper.findAll('button').find((button) => button.text() === 'All time')!
    await allTime.trigger('click')

    expect(wrapper.emitted('year')).toContainEqual([null])
  })

  it('offers mouse and keyboard controls when older years overflow', async () => {
    const wrapper = mountPicker()
    const scroller = wrapper.get('[data-year-scroller]').element as HTMLElement
    Object.defineProperties(scroller, {
      clientWidth: { configurable: true, value: 240 },
      scrollWidth: { configurable: true, value: 600 },
    })
    const scrollBy = vi.fn<(options?: ScrollToOptions) => void>()
    Object.defineProperty(scroller, 'scrollBy', { configurable: true, value: scrollBy })
    scroller.dispatchEvent(new Event('scroll'))
    await nextTick()

    await wrapper.get('button[aria-label="Show older years"]').trigger('click')

    expect(scrollBy).toHaveBeenCalledWith({ left: 180, behavior: 'auto' })
  })

  it('reveals a selected year that is outside the visible range', async () => {
    const wrapper = mountPicker()
    const scroller = wrapper.get('[data-year-scroller]').element as HTMLElement
    Object.defineProperties(scroller, {
      clientWidth: { configurable: true, value: 240 },
      scrollWidth: { configurable: true, value: 600 },
    })
    scroller.getBoundingClientRect = () => ({ left: 0, right: 240 }) as DOMRect
    const oldYear = wrapper.findAll('[data-year-scroller] button').find((button) => button.text().includes('1998'))!.element as HTMLElement
    oldYear.getBoundingClientRect = () => ({ left: 480, right: 560 }) as DOMRect

    await wrapper.setProps({ year: 1998 })
    await nextTick()

    expect(scroller.scrollLeft).toBe(480)
  })
})
