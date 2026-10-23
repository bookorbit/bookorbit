import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import EmailTokenField from '../EmailTokenField.vue'

describe('EmailTokenField', () => {
  it('tints each variable in the text it mirrors', () => {
    const wrapper = mount(EmailTokenField, { props: { id: 'subject', modelValue: 'Book club: {{title}} by {{author}}' } })

    const tokens = wrapper.findAll('[aria-hidden="true"] span').map((span) => span.text())
    expect(tokens).toEqual(['{{title}}', '{{author}}'])
  })

  it('reports what is typed', async () => {
    const wrapper = mount(EmailTokenField, { props: { id: 'subject', modelValue: '' } })

    await wrapper.get('input').setValue('Your copy of {{title}}')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['Your copy of {{title}}'])
  })

  it('shows composing text but reports it only once the input method commits it', async () => {
    const wrapper = mount(EmailTokenField, { props: { id: 'body', modelValue: '', multiline: true } })
    const textarea = wrapper.get('textarea')

    ;(textarea.element as HTMLTextAreaElement).value = 'にほ'
    textarea.element.dispatchEvent(new InputEvent('input', { isComposing: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[aria-hidden="true"]').text()).toContain('にほ')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()

    ;(textarea.element as HTMLTextAreaElement).value = '日本'
    await textarea.trigger('compositionend')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['日本'])
  })
})
