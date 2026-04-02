import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ReaderFooter from '../ReaderFooter.vue'

const globalStubs = {
  stubs: {
    Tooltip: { template: '<div><slot /></div>' },
    TooltipTrigger: { template: '<div><slot /></div>' },
    TooltipContent: { template: '<div><slot /></div>' },
  },
}

describe('ReaderFooter', () => {
  it('disables previous button on first section and next button on last section', async () => {
    const first = mount(ReaderFooter, {
      props: {
        fraction: 0.1,
        sectionIndex: 0,
        totalSections: 5,
        sectionFractions: [],
      },
      global: globalStubs,
    })

    const firstButtons = first.findAll('button')
    expect(firstButtons[0]?.attributes('disabled')).toBeDefined()
    expect(firstButtons[1]?.attributes('disabled')).toBeUndefined()

    const last = mount(ReaderFooter, {
      props: {
        fraction: 0.9,
        sectionIndex: 4,
        totalSections: 5,
        sectionFractions: [],
      },
      global: globalStubs,
    })

    const lastButtons = last.findAll('button')
    expect(lastButtons[1]?.attributes('disabled')).toBeDefined()
  })

  it('emits prev/next section and seek events', async () => {
    const wrapper = mount(ReaderFooter, {
      props: {
        fraction: 0.33,
        sectionIndex: 2,
        totalSections: 5,
        sectionFractions: [0.2, 0.5, 0.8],
      },
      global: globalStubs,
    })

    const buttons = wrapper.findAll('button')
    await buttons[0]!.trigger('click')
    await buttons[1]!.trigger('click')

    const slider = wrapper.get('input[type="range"]')
    await slider.setValue('0.42')

    expect(wrapper.emitted('prevSection')?.length).toBe(1)
    expect(wrapper.emitted('nextSection')?.length).toBe(1)
    expect(wrapper.emitted('seek')?.[0]).toEqual([0.42])
  })
})
