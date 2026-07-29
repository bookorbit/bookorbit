import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AuditActorPicker from '../AuditActorPicker.vue'

const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')

describe('AuditActorPicker', () => {
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

  it('shows a bounded searchable actor list with user IDs', async () => {
    const wrapper = mount(AuditActorPicker, {
      attachTo: document.body,
      props: {
        actors: [
          { userId: 14, username: 'demo-freja' },
          { userId: 1, username: 'neon' },
        ],
        id: 'audit-actor',
        modelValue: 'demo-freja',
      },
    })

    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('demo-freja')

    await wrapper.get('button').trigger('click')
    await nextTick()

    expect(document.body.textContent).toContain('All actors')
    expect(document.body.textContent).toContain('demo-freja')
    expect(document.body.textContent).toContain('#14')
    expect(document.body.querySelector('.max-h-60')).not.toBeNull()

    wrapper.unmount()
  })
})
