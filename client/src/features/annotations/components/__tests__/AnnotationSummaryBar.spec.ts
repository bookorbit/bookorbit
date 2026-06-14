import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AnnotationSummaryBar from '../AnnotationSummaryBar.vue'

const origins = [
  { origin: 'web', label: 'Web', class: 'web-class', count: 3 },
  { origin: 'koreader', label: 'KOReader', class: 'ko-class', count: 5 },
]

describe('AnnotationSummaryBar', () => {
  it('renders text summaries and origin counts', () => {
    const wrapper = mount(AnnotationSummaryBar, { props: { texts: ['12 highlights', '4 notes'], origins } })
    expect(wrapper.text()).toContain('12 highlights')
    expect(wrapper.text()).toContain('Web 3')
    expect(wrapper.text()).toContain('KOReader 5')
  })

  it('is non-interactive when no activeOrigin is provided', () => {
    const wrapper = mount(AnnotationSummaryBar, { props: { texts: [], origins } })
    expect(wrapper.findAll('button')).toHaveLength(0)
  })

  it('emits originClick and marks the active origin when interactive', async () => {
    const wrapper = mount(AnnotationSummaryBar, { props: { texts: [], origins, activeOrigin: 'web' } })
    const buttons = wrapper.findAll('button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0]!.attributes('aria-pressed')).toBe('true')
    expect(buttons[1]!.attributes('aria-pressed')).toBe('false')

    await buttons[1]!.trigger('click')
    expect(wrapper.emitted('originClick')!.slice(-1)[0]).toEqual(['koreader'])
  })

  it('treats a null activeOrigin as interactive with none pressed', () => {
    const wrapper = mount(AnnotationSummaryBar, { props: { texts: [], origins, activeOrigin: null } })
    const buttons = wrapper.findAll('button')
    expect(buttons).toHaveLength(2)
    expect(buttons.every((button) => button.attributes('aria-pressed') === 'false')).toBe(true)
  })
})
