import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('reka-ui', () => ({
  TooltipArrow: {
    inheritAttrs: false,
    template: '<span data-testid="tooltip-arrow" v-bind="$attrs" />',
  },
  TooltipContent: {
    inheritAttrs: false,
    template: '<div data-testid="tooltip-content" v-bind="$attrs"><slot /></div>',
  },
  TooltipPortal: {
    template: '<div data-testid="tooltip-portal"><slot /></div>',
  },
  useForwardPropsEmits: (props: unknown) => props,
}))

import TooltipContent from '../TooltipContent.vue'

describe('TooltipContent', () => {
  it('renders above modal and popover layers', () => {
    const wrapper = mount(TooltipContent, {
      slots: { default: 'Organization mode is locked' },
    })

    expect(wrapper.get('[data-testid="tooltip-content"]').classes()).toContain('z-[110]')
    expect(wrapper.get('[data-testid="tooltip-arrow"]').classes()).toContain('z-[110]')
  })
})
