import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import NoteDialog from '../NoteDialog.vue'

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(NoteDialog, {
    props: {
      selectedText: 'Selected quote',
      modelValue: 'initial note',
      ...props,
    },
    attachTo: document.body,
  })
}

function buttons() {
  return [...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
}

describe('NoteDialog', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('is a labelled modal dialog', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog!.getAttribute('aria-modal')).toBe('true')
    const title = document.getElementById(dialog!.getAttribute('aria-labelledby') ?? '')
    expect(title?.textContent).toBe('Add note')
    expect(dialog!.querySelector('textarea')?.getAttribute('aria-label')).toBe('Add note')
    wrapper.unmount()
  })

  it('emits note updates, save, and cancel actions', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    const textarea = document.body.querySelector('textarea')!
    textarea.value = 'updated note'
    textarea.dispatchEvent(new Event('input'))
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['updated note'])

    buttons()[0]!.click()
    buttons()[1]!.click()

    expect(wrapper.emitted('cancel')?.length).toBe(1)
    expect(wrapper.emitted('save')?.[0]).toEqual(['initial note'])
    wrapper.unmount()
  })

  it('cancels on Escape', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    document.body.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()

    expect(wrapper.emitted('cancel')?.length).toBe(1)
    wrapper.unmount()
  })

  it('stays open and sends nothing while saving', async () => {
    const wrapper = mountDialog({ saving: true })
    await flushPromises()

    document.body.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    buttons()[1]!.click()
    await flushPromises()

    expect(wrapper.emitted('cancel')).toBeUndefined()
    expect(wrapper.emitted('save')).toBeUndefined()
    wrapper.unmount()
  })
})
