import { nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuditAction } from '@bookorbit/types'
import AuditActionPicker from '../AuditActionPicker.vue'

const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')

describe('AuditActionPicker', () => {
  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn<() => void>(),
      writable: true,
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
    if (scrollIntoViewDescriptor) {
      Object.defineProperty(Element.prototype, 'scrollIntoView', scrollIntoViewDescriptor)
    } else {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })

  it('shows readable labels in a bounded searchable popup', async () => {
    const wrapper = mount(AuditActionPicker, {
      attachTo: document.body,
      props: {
        id: 'audit-action',
        modelValue: AuditAction.BookBulkDelete,
      },
    })

    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('Delete books')

    await wrapper.get('button').trigger('click')
    await nextTick()

    expect(document.body.textContent).toContain('Delete books')
    expect(document.body.textContent).not.toContain(AuditAction.BookBulkDelete)
    expect(document.body.querySelector('.max-h-72')).not.toBeNull()

    wrapper.unmount()
  })

  it('keeps the readable label after selecting an event type', async () => {
    const wrapper = mount(AuditActionPicker, {
      attachTo: document.body,
      props: {
        id: 'audit-action',
        modelValue: '',
      },
    })

    await wrapper.get('button').trigger('click')
    await nextTick()

    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (item) => item.textContent?.trim() === 'Update book metadata',
    )
    expect(option).toBeDefined()
    option?.click()
    await flushPromises()

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([AuditAction.BookMetadataUpdate])

    await wrapper.setProps({ modelValue: AuditAction.BookMetadataUpdate })
    await flushPromises()

    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('Update book metadata')
    expect((wrapper.get('input').element as HTMLInputElement).value).not.toBe(AuditAction.BookMetadataUpdate)

    wrapper.unmount()
  })
})
