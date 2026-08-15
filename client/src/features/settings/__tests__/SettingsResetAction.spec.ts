import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SettingsResetAction from '../SettingsResetAction.vue'

describe('SettingsResetAction', () => {
  it('renders the shared responsive reset button and emits reset', async () => {
    const wrapper = mount(SettingsResetAction)
    const button = wrapper.get('button')

    expect(button.text()).toBe('Reset to defaults')
    expect(button.classes()).toContain('w-full')
    expect(button.classes()).toContain('md:w-auto')

    await button.trigger('click')
    expect(wrapper.emitted('reset')).toHaveLength(1)
  })
})
