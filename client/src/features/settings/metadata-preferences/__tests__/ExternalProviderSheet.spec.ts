import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import ExternalProviderSheet from '../components/ExternalProviderSheet.vue'

// The real sheet portals into a reka dialog; the stub renders its slots in place and exposes `dirty`.
const SheetStub = defineComponent({
  name: 'SettingsEditorSheet',
  props: ['open', 'title', 'description', 'dirty', 'busy', 'removable', 'removeLabel', 'removeConfirm', 'removeConsequence', 'menuActions'],
  emits: ['save', 'cancel', 'remove', 'action'],
  setup(props, { slots }) {
    return () => h('div', { 'data-dirty': String(props.dirty) }, [slots.status?.(), slots.default?.(), slots.footer?.({ requestClose: () => {} })])
  },
})

function mountSheet(prefill: { baseUrl: string; allowPrivateAddress: boolean } | null) {
  return mount(ExternalProviderSheet, {
    props: { open: true, provider: null, busy: false, testing: false, testResult: null, error: null, prefill },
    global: { stubs: { SettingsEditorSheet: SheetStub } },
  })
}

describe('ExternalProviderSheet', () => {
  it('starts from a ready-made provider without counting its address as an edit', async () => {
    const wrapper = mountSheet({ baseUrl: 'http://libris:8080', allowPrivateAddress: true })

    expect((wrapper.get('input[type="url"]').element as HTMLInputElement).value).toBe('http://libris:8080')
    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('true')
    expect(wrapper.get('[data-dirty]').attributes('data-dirty')).toBe('false')

    await wrapper.get('input[type="url"]').setValue('http://libris:9000')
    expect(wrapper.get('[data-dirty]').attributes('data-dirty')).toBe('true')
  })

  it('starts empty, with private addresses refused, when added by hand', () => {
    const wrapper = mountSheet(null)

    expect((wrapper.get('input[type="url"]').element as HTMLInputElement).value).toBe('')
    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('false')
  })
})
