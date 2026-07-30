import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SidebarBadge from '../SidebarBadge.vue'

describe('SidebarBadge', () => {
  it.each(['count', 'progress', 'dot'] as const)('hides the %s badge when the sidebar is collapsed to icons', (variant) => {
    const wrapper = mount(SidebarBadge, {
      props: { variant },
      slots: { default: '29' },
    })

    expect(wrapper.get('span').classes()).toContain('group-data-[collapsible=icon]:hidden')
  })
})
