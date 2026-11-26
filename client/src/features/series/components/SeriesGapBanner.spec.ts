import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SeriesGapBanner from './SeriesGapBanner.vue'

describe('SeriesGapBanner', () => {
  it('keeps the bare numbers for a series without units', () => {
    const wrapper = mount(SeriesGapBanner, { props: { gaps: [13, 14] } })

    expect(wrapper.text()).toBe('Possible gaps: #13, #14')
  })

  it('keeps the bare numbers for a series of volumes alone', () => {
    const wrapper = mount(SeriesGapBanner, { props: { gaps: [5], chapterGaps: [], unitCounts: { volume: 9, chapter: 0, issue: 0 } } })

    expect(wrapper.text()).toBe('Possible gaps: #5')
  })

  it('names volume and chapter gaps by kind', () => {
    const wrapper = mount(SeriesGapBanner, { props: { gaps: [5], chapterGaps: [93], unitCounts: { volume: 9, chapter: 20, issue: 0 } } })

    expect(wrapper.text()).toBe('Possible gaps: Vol. 5, Ch. 93')
  })

  it('names issue gaps with a hash', () => {
    const wrapper = mount(SeriesGapBanner, { props: { gaps: [], chapterGaps: [13, 14], unitCounts: { volume: 2, chapter: 0, issue: 16 } } })

    expect(wrapper.text()).toBe('Possible gaps: #13, #14')
  })

  it('renders nothing without gaps', () => {
    const wrapper = mount(SeriesGapBanner, { props: { gaps: [], chapterGaps: [], unitCounts: { volume: 2, chapter: 3, issue: 0 } } })

    expect(wrapper.html()).toBe('<!--v-if-->')
  })
})
