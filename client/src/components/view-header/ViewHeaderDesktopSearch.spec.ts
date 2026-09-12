import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ViewHeaderDesktopSearch from './ViewHeaderDesktopSearch.vue'

const stubs = {
  Tooltip: { template: '<div><slot /></div>' },
  TooltipTrigger: { template: '<div><slot /></div>' },
  TooltipContent: { template: '<div data-testid="tooltip-content"><slot /></div>' },
}

describe('ViewHeaderDesktopSearch', () => {
  it('labels and describes the collapsed search control', () => {
    const wrapper = mount(ViewHeaderDesktopSearch, { global: { stubs } })

    expect(wrapper.get('input').attributes('aria-label')).toBe('Search')
    expect(wrapper.get('[data-testid="tooltip-content"]').text()).toBe('Search')
  })

  it('labels the close action after search expands', async () => {
    const wrapper = mount(ViewHeaderDesktopSearch, { global: { stubs } })

    await wrapper.get('input').trigger('focus')

    expect(wrapper.get('button').attributes('aria-label')).toBe('Close')
    expect(wrapper.findAll('[data-testid="tooltip-content"]').map((content) => content.text())).toEqual(['Search', 'Close'])
  })
})
