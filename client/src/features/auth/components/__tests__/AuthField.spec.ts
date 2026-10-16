import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AuthField from '../AuthField.vue'

function mountField(type: 'text' | 'password' = 'password', hint?: string) {
  return mount(AuthField, {
    props: { id: 'secret', label: 'Password', autocomplete: 'current-password', type, hint, modelValue: '', 'onUpdate:modelValue': () => {} },
  })
}

describe('AuthField', () => {
  it('labels the input it draws', () => {
    const wrapper = mountField('text')

    expect(wrapper.get('label').attributes('for')).toBe('secret')
    expect(wrapper.get('input').attributes('id')).toBe('secret')
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('reveals and hides a password', async () => {
    const wrapper = mountField()
    const toggle = wrapper.get('button[aria-controls="secret"]')

    expect(wrapper.get('input').attributes('type')).toBe('password')
    expect(toggle.attributes('aria-label')).toBe('Show password')

    await toggle.trigger('click')

    expect(wrapper.get('input').attributes('type')).toBe('text')
    expect(toggle.attributes('aria-pressed')).toBe('true')
    expect(toggle.attributes('aria-label')).toBe('Hide password')
  })

  it('warns while Caps Lock is on and stops warning on blur', async () => {
    const wrapper = mountField()
    const input = wrapper.get('input')

    await input.trigger('keydown', { key: 'A', modifierCapsLock: true })

    expect(wrapper.text()).toContain('Caps Lock is on')
    expect(input.attributes('aria-describedby')).toBe('secret-caps')

    await input.trigger('blur')

    expect(wrapper.text()).not.toContain('Caps Lock is on')
  })

  it('describes the input with its hint', () => {
    const wrapper = mountField('password', 'Min. 8 characters')

    expect(wrapper.get('input').attributes('aria-describedby')).toBe('secret-hint')
    expect(wrapper.get('#secret-hint').text()).toBe('Min. 8 characters')
  })
})
