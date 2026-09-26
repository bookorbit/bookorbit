import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import FormSheet from '../FormSheet.vue'

const stubs = {
  Sheet: { name: 'Sheet', props: ['open'], emits: ['update:open'], template: '<div><slot /></div>' },
  SheetContent: { name: 'SheetContent', template: '<div><slot /></div>' },
  SheetHeader: { name: 'SheetHeader', template: '<div><slot /></div>' },
  SheetTitle: { name: 'SheetTitle', template: '<h2><slot /></h2>' },
  SheetDescription: { name: 'SheetDescription', template: '<p><slot /></p>' },
  SheetFooter: { name: 'SheetFooter', template: '<div><slot /></div>' },
}

function mountSheet(props: Record<string, unknown> = {}) {
  return mount(FormSheet, {
    props: { open: true, title: 'Edit details', ...props },
    global: { stubs },
  })
}

function footerButton(wrapper: ReturnType<typeof mountSheet>, label: string) {
  return wrapper.findAll('button').find((button) => button.text() === label)!
}

describe('FormSheet', () => {
  it('announces the open so a host can seed the form, and re-announces when the record changes', async () => {
    // The watcher is immediate, so a sheet mounted closed reports one `closed` before anything else.
    const wrapper = mountSheet({ open: false, resetKey: 1 })
    expect(wrapper.emitted('opened')).toBeUndefined()
    expect(wrapper.emitted('closed')).toHaveLength(1)

    await wrapper.setProps({ open: true })
    expect(wrapper.emitted('opened')).toHaveLength(1)

    await wrapper.setProps({ resetKey: 2 })
    expect(wrapper.emitted('opened')).toHaveLength(2)

    await wrapper.setProps({ open: false })
    expect(wrapper.emitted('closed')).toHaveLength(2)
  })

  it('closes straight away when nothing is unsaved', async () => {
    const wrapper = mountSheet()

    await footerButton(wrapper, 'Cancel').trigger('click')

    expect(wrapper.emitted('update:open')).toEqual([[false]])
    expect(wrapper.findComponent(ConfirmDialog).exists()).toBe(false)
  })

  it('asks before discarding unsaved edits, and stays open if the answer is no', async () => {
    const wrapper = mountSheet({ dirty: true })

    await footerButton(wrapper, 'Cancel').trigger('click')

    expect(wrapper.emitted('update:open')).toBeUndefined()
    const dialog = wrapper.findComponent(ConfirmDialog)
    expect(dialog.props('title')).toBe('Discard changes?')

    dialog.vm.$emit('cancel')
    await wrapper.vm.$nextTick()
    expect(wrapper.findComponent(ConfirmDialog).exists()).toBe(false)
    expect(wrapper.emitted('update:open')).toBeUndefined()

    await footerButton(wrapper, 'Cancel').trigger('click')
    wrapper.findComponent(ConfirmDialog).vm.$emit('confirm')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })

  it('guards a backdrop or escape close the same way as the cancel button', async () => {
    const wrapper = mountSheet({ dirty: true })

    wrapper.findComponent({ name: 'Sheet' }).vm.$emit('update:open', false)
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('update:open')).toBeUndefined()
    expect(wrapper.findComponent(ConfirmDialog).exists()).toBe(true)
  })

  it('disables both footer buttons while a write is in flight and neither closes the sheet', async () => {
    const wrapper = mountSheet({ busy: true })

    expect(footerButton(wrapper, 'Cancel').attributes('disabled')).toBeDefined()
    expect(footerButton(wrapper, 'Save').attributes('disabled')).toBeDefined()

    wrapper.findComponent({ name: 'Sheet' }).vm.$emit('update:open', false)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('update:open')).toBeUndefined()
  })

  it('keeps cancel usable when only the submit is blocked', () => {
    const wrapper = mountSheet({ submitDisabled: true })

    expect(footerButton(wrapper, 'Cancel').attributes('disabled')).toBeUndefined()
    expect(footerButton(wrapper, 'Save').attributes('disabled')).toBeDefined()
  })

  it('renders one error surface beside the footer actions', () => {
    const wrapper = mountSheet({ error: 'Name is required' })

    expect(wrapper.get('[role="alert"]').text()).toBe('Name is required')
  })
})
