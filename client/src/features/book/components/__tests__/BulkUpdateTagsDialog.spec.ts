import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import BulkUpdateTagsDialog from '../BulkUpdateTagsDialog.vue'

describe('BulkUpdateTagsDialog', () => {
  it('allows replace mode to submit with no tags to clear all tags', async () => {
    const wrapper = mount(BulkUpdateTagsDialog, {
      props: {
        open: true,
        bookCount: 2,
      },
      global: {
        stubs: {
          Teleport: true,
        },
      },
    })

    const replaceButton = wrapper.findAll('button').find((button) => button.text() === 'Replace all')

    await replaceButton!.trigger('click')
    await nextTick()

    const applyButton = wrapper.findAll('button').find((button) => button.text() === 'Apply')
    await applyButton!.trigger('click')

    expect(wrapper.emitted('confirm')).toEqual([['replace', []]])
    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })

  it('resets draft state when the dialog closes externally', async () => {
    const wrapper = mount(BulkUpdateTagsDialog, {
      props: {
        open: true,
        bookCount: 1,
      },
      global: {
        stubs: {
          Teleport: true,
        },
      },
    })

    const input = wrapper.get('#bulk-tag-input')
    await input.setValue('sci-fi')
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    expect(wrapper.get('#bulk-tag-input').element).toHaveProperty('value', '')
  })
})
