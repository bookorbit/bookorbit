import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { i18n } from '@/i18n'
import RichDescriptionEditor from '../RichDescriptionEditor.vue'

const stubs = {
  Tooltip: { template: '<div><slot /></div>' },
  TooltipTrigger: { template: '<div><slot /></div>' },
  TooltipContent: true,
}

describe('RichDescriptionEditor', () => {
  it('does not emit a metadata change when temporarily disabled', async () => {
    const wrapper = mount(RichDescriptionEditor, {
      props: {
        modelValue: 'First paragraph.\n\nSecond paragraph.',
        disabled: false,
      },
      global: { stubs },
    })

    await wrapper.setProps({ disabled: true })
    await wrapper.setProps({ disabled: false })

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('styles the editor and its preview with the description rules every book screen uses', async () => {
    const wrapper = mount(RichDescriptionEditor, {
      props: { modelValue: '<p>First paragraph.</p><p>Second paragraph.</p>' },
      global: { stubs },
    })
    await flushPromises()

    expect(wrapper.get('.ProseMirror').classes()).toContain('description-content')

    const previewLabel = i18n.global.t('book.detail.richDescription.previewDescription')
    await wrapper.get(`button[aria-label="${previewLabel}"]`).trigger('click')

    const preview = wrapper.get('.description-content')
    expect(preview.findAll('p').map((paragraph) => paragraph.text())).toEqual(['First paragraph.', 'Second paragraph.'])
  })
})
