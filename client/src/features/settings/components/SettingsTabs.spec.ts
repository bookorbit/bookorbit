import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SettingsTabs from './SettingsTabs.vue'

describe('SettingsTabs', () => {
  it('reveals the active tab when it is outside the horizontal viewport', async () => {
    const wrapper = mount(SettingsTabs, {
      props: {
        tabs: [
          { id: 'first', label: 'First' },
          { id: 'last', label: 'Last' },
        ],
        activeTab: 'first',
      },
    })
    const container = wrapper.element as HTMLElement
    Object.defineProperties(container, {
      clientWidth: { configurable: true, value: 320 },
      scrollWidth: { configurable: true, value: 640 },
    })
    container.getBoundingClientRect = () => ({ left: 0, right: 320 }) as DOMRect

    const lastTab = wrapper.get('[role="tab"]:last-child').element as HTMLElement
    lastTab.getBoundingClientRect = () => ({ left: 520, right: 600 }) as DOMRect
    await wrapper.setProps({ activeTab: 'last' })
    await nextTick()

    expect(container.scrollLeft).toBe(520)
  })

  it('emits the selected section and marks the active section as current', async () => {
    const wrapper = mount(SettingsTabs, {
      props: {
        tabs: [
          { id: 'display', label: 'Display' },
          { id: 'account', label: 'Account' },
        ],
        activeTab: 'account',
        variant: 'section',
      },
    })

    expect(wrapper.get('[aria-current="page"]').text()).toBe('Account')
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['display']])
  })
})
