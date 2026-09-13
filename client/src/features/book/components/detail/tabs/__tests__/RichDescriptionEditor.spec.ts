import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import RichDescriptionEditor from '../RichDescriptionEditor.vue'

describe('RichDescriptionEditor', () => {
  it('does not emit a metadata change when temporarily disabled', async () => {
    const wrapper = mount(RichDescriptionEditor, {
      props: {
        modelValue: 'First paragraph.\n\nSecond paragraph.',
        disabled: false,
      },
      global: {
        stubs: {
          Tooltip: { template: '<div><slot /></div>' },
          TooltipTrigger: { template: '<div><slot /></div>' },
          TooltipContent: true,
        },
      },
    })

    await wrapper.setProps({ disabled: true })
    await wrapper.setProps({ disabled: false })

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})
