import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ToggleSwitch from './ToggleSwitch.vue'

describe('ToggleSwitch', () => {
  it('keeps the thumb contained at logical track positions', async () => {
    const wrapper = mount(ToggleSwitch, { props: { modelValue: false } })
    const track = wrapper.get('[role="switch"]')
    const thumb = track.get('span')

    expect(track.classes()).toContain('overflow-hidden')
    expect(thumb.classes()).toEqual(expect.arrayContaining(['absolute', 'start-0']))
    expect(track.attributes('aria-checked')).toBe('false')

    await wrapper.setProps({ modelValue: true })

    expect(thumb.classes()).toContain('start-4')
    expect(thumb.classes()).not.toContain('start-0')
    expect(track.attributes('aria-checked')).toBe('true')
  })

  it('emits the next checked state when clicked', async () => {
    const wrapper = mount(ToggleSwitch, { props: { modelValue: false } })

    await wrapper.get('[role="switch"]').trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([[true]])
  })
})
