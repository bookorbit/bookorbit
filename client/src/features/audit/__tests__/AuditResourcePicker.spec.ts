import { nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuditResource } from '@bookorbit/types'
import AuditResourcePicker from '../AuditResourcePicker.vue'

const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')

describe('AuditResourcePicker', () => {
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

  it('shows readable color-coded target types in a bounded popup', async () => {
    const wrapper = mount(AuditResourcePicker, {
      attachTo: document.body,
      props: {
        id: 'audit-resource',
        modelValue: AuditResource.SmartScope,
      },
    })

    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('Smart scope')

    await wrapper.get('button').trigger('click')
    await nextTick()

    expect(document.body.textContent).toContain('All target types')
    expect(document.body.textContent).toContain('Application settings')
    expect(document.body.textContent).not.toContain(AuditResource.SmartScope)
    expect(document.body.querySelector('.max-h-72')).not.toBeNull()
    expect(document.body.querySelector('[class*="pill-web"]')).not.toBeNull()

    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (item) => item.textContent?.trim() === 'Application settings',
    )
    expect(option).toBeDefined()
    option?.click()
    await flushPromises()

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([AuditResource.AppSettings])

    await wrapper.setProps({ modelValue: AuditResource.AppSettings })
    await flushPromises()

    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('Application settings')
    expect((wrapper.get('input').element as HTMLInputElement).value).not.toBe(AuditResource.AppSettings)

    wrapper.unmount()
  })
})
