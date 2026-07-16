import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import DeleteDuplicateBooksDialog from './DeleteDuplicateBooksDialog.vue'

describe('DeleteDuplicateBooksDialog', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('uses an accessible modal and delegates explicit confirmation', async () => {
    const wrapper = mount(DeleteDuplicateBooksDialog, {
      props: { open: true, count: 2, deleting: false },
      attachTo: document.body,
    })
    await flushPromises()

    const dialog = document.body.querySelector('[role="dialog"]')!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.textContent).toContain('Permanently delete duplicate books?')

    const confirm = [...dialog.querySelectorAll('button')].find((button) => button.textContent?.includes('Delete 2 books'))!
    confirm.click()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('confirm')).toHaveLength(1)
    wrapper.unmount()
  })

  it('prevents cancellation while deletion is in progress', async () => {
    const wrapper = mount(DeleteDuplicateBooksDialog, {
      props: { open: true, count: 1, deleting: true },
      attachTo: document.body,
    })
    await flushPromises()
    const dialog = document.body.querySelector('[role="dialog"]')!
    const cancel = [...dialog.querySelectorAll('button')].find((button) => button.textContent?.includes('Cancel'))!

    cancel.click()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('cancel')).toBeUndefined()
    expect(cancel.disabled).toBe(true)
    wrapper.unmount()
  })

  it('delegates cancellation when deletion has not started', async () => {
    const wrapper = mount(DeleteDuplicateBooksDialog, {
      props: { open: true, count: 1, deleting: false },
      attachTo: document.body,
    })
    await flushPromises()
    const dialog = document.body.querySelector('[role="dialog"]')!
    const cancel = [...dialog.querySelectorAll('button')].find((button) => button.textContent?.includes('Cancel'))!

    cancel.click()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    wrapper.unmount()
  })
})
