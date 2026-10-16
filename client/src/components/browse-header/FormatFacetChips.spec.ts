import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import FormatFacetChips from './FormatFacetChips.vue'

describe('FormatFacetChips', () => {
  it('shows each format with its count and marks the picked ones', () => {
    const wrapper = mount(FormatFacetChips, {
      props: {
        facets: [
          { format: 'epub', count: 380 },
          { format: 'mobi', count: 55 },
        ],
        selected: ['mobi'],
      },
    })

    const chips = wrapper.findAll('button')
    expect(chips.map((chip) => chip.attributes('aria-pressed'))).toEqual(['false', 'true'])
    expect(chips[0]!.text()).toContain('380')
    expect(chips[1]!.text()).toContain('55')
  })

  it('keeps a picked format whose count fell to nothing, so it can still be unpicked', async () => {
    const wrapper = mount(FormatFacetChips, {
      props: { facets: [{ format: 'epub', count: 241 }], selected: ['pdf'] },
    })

    const chips = wrapper.findAll('button')
    expect(chips).toHaveLength(2)
    expect(chips[1]!.attributes('aria-pressed')).toBe('true')
    expect(chips[1]!.text()).toContain('0')

    await chips[1]!.trigger('click')
    expect(wrapper.emitted('toggle')).toEqual([['pdf']])
  })
})
