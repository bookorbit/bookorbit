import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BulkRenameConfirmDialog from '../BulkRenameConfirmDialog.vue'

describe('BulkRenameConfirmDialog', () => {
  function mountDialog(props: { open: boolean; renameCount: number }) {
    return mount(BulkRenameConfirmDialog, {
      props,
      global: {
        stubs: { Teleport: true },
      },
    })
  }

  it('renders nothing when open is false', () => {
    const wrapper = mountDialog({ open: false, renameCount: 5 })
    expect(wrapper.find('.fixed').exists()).toBe(false)
  })

  it('renders dialog when open is true', () => {
    const wrapper = mountDialog({ open: true, renameCount: 5 })
    expect(wrapper.find('.fixed').exists()).toBe(true)
    expect(wrapper.text()).toContain('Confirm Bulk Rename')
  })

  it('shows the rename count in the message', () => {
    const wrapper = mountDialog({ open: true, renameCount: 42 })
    expect(wrapper.text()).toContain('42')
    expect(wrapper.text()).toContain('books')
  })

  it('shows singular for 1 book', () => {
    const wrapper = mountDialog({ open: true, renameCount: 1 })
    expect(wrapper.text()).toContain('1 book')
    expect(wrapper.text()).not.toContain('1 books')
  })

  it('emits confirm when confirm button is clicked', async () => {
    const wrapper = mountDialog({ open: true, renameCount: 5 })
    const buttons = wrapper.findAll('button')
    const confirmButton = buttons.find((b) => b.text().includes('Rename'))!
    await confirmButton.trigger('click')
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })

  it('emits cancel when cancel button is clicked', async () => {
    const wrapper = mountDialog({ open: true, renameCount: 5 })
    const cancelButton = wrapper.findAll('button').find((b) => b.text() === 'Cancel')!
    await cancelButton.trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })
})
