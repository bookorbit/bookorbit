import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import NoteDialog from '../NoteDialog.vue'

describe('NoteDialog', () => {
  it('emits note updates, save, and cancel actions', async () => {
    const wrapper = mount(NoteDialog, {
      props: {
        selectedText: 'Selected quote',
        modelValue: 'initial note',
      },
      global: {
        stubs: {
          teleport: true,
        },
      },
    })

    await wrapper.get('textarea').setValue('updated note')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['updated note'])

    const buttons = wrapper.findAll('button')
    await buttons[0]!.trigger('click')
    await buttons[1]!.trigger('click')

    expect(wrapper.emitted('cancel')?.length).toBe(1)
    expect(wrapper.emitted('save')?.[0]).toEqual(['initial note'])
  })

  it('emits cancel when backdrop is clicked', async () => {
    const wrapper = mount(NoteDialog, {
      props: {
        selectedText: 'Selected quote',
        modelValue: '',
      },
      global: {
        stubs: {
          teleport: true,
        },
      },
    })

    await wrapper.get('.fixed.inset-0').trigger('click')
    expect(wrapper.emitted('cancel')?.length).toBe(1)
  })
})
