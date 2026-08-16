import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it } from 'vitest'
import ReaderSettingsSheet from '../ReaderSettingsSheet.vue'

const SheetStub = defineComponent({
  name: 'SheetStub',
  props: { open: { type: Boolean, default: false } },
  emits: ['update:open'],
  template: '<div data-testid="sheet"><slot /></div>',
})

const SheetContentStub = defineComponent({
  name: 'SheetContentStub',
  template: '<div data-testid="sheet-content"><slot /></div>',
})

function mountSheet(props: Record<string, unknown> = {}) {
  return mount(ReaderSettingsSheet, {
    props: { open: true, ...props },
    slots: { default: '<p data-testid="panel">Panel body</p>' },
    global: { stubs: { Sheet: SheetStub, SheetContent: SheetContentStub } },
  })
}

describe('ReaderSettingsSheet', () => {
  it('renders the settings panel passed into the default slot', () => {
    const wrapper = mountSheet()

    expect(wrapper.get('[data-testid="panel"]').text()).toBe('Panel body')
  })

  it('forwards the open state to the sheet', async () => {
    const wrapper = mountSheet({ open: false })
    expect(wrapper.findComponent(SheetStub).props('open')).toBe(false)

    await wrapper.setProps({ open: true })
    expect(wrapper.findComponent(SheetStub).props('open')).toBe(true)
  })

  describe('closing', () => {
    // The reported bug: `hide-close` dropped the built-in X and nothing replaced it, so on a phone
    // there was no reachable way out of the panel at all. Every assertion here guards one of the
    // three exits the reporter found missing.
    it('offers a close button with an accessible label', () => {
      const wrapper = mountSheet()
      const close = wrapper.get('button[aria-label="Close settings"]')

      expect(close.element.tagName).toBe('BUTTON')
      expect(close.attributes('type')).toBe('button')
    })

    it('emits update:open false when the close button is activated', async () => {
      const wrapper = mountSheet()

      await wrapper.get('button[aria-label="Close settings"]').trigger('click')

      expect(wrapper.emitted('update:open')).toEqual([[false]])
    })

    it('forwards the sheet dismissing itself, which covers overlay taps and Escape', () => {
      const wrapper = mountSheet()

      wrapper.findComponent(SheetStub).vm.$emit('update:open', false)

      expect(wrapper.emitted('update:open')).toEqual([[false]])
    })

    it('emits nothing until something is actually activated', () => {
      const wrapper = mountSheet()

      expect(wrapper.emitted('update:open')).toBeUndefined()
    })

    it('keeps the close button as the only interactive control in the sheet chrome', () => {
      const wrapper = mountSheet()
      const buttons = wrapper.findAll('button')

      expect(buttons).toHaveLength(1)
      expect(buttons[0].attributes('aria-label')).toBe('Close settings')
    })

    it('leaves the grab handle decorative rather than passing it off as a control', () => {
      // The reporter tried to drag this and it did nothing. There is no swipe-to-dismiss, so the
      // handle must stay hidden from assistive tech instead of advertising an exit that is not there.
      const wrapper = mountSheet()
      const handle = wrapper.get('[data-testid="sheet-content"] .rounded-full')

      expect(handle.element.tagName).toBe('DIV')
      expect(handle.attributes('aria-hidden')).toBe('true')
    })
  })

  describe('sheet geometry', () => {
    it('caps its height against the dynamic viewport, not the large viewport', () => {
      // `vh` resolves against the toolbar-retracted viewport. On a phone browser with its chrome
      // showing, `max-h-[85vh]` covered essentially the whole visible area and left no overlay to
      // tap, which is why the panel could only be dismissed in fullscreen. Asserting the class is
      // crude, but jsdom has no layout, and this is the exact token that regressed.
      const content = mountSheet().get('[data-testid="sheet-content"]')

      expect(content.classes()).toContain('max-h-[85dvh]')
      expect(content.classes()).not.toContain('max-h-[85vh]')
    })

    it('suppresses the built-in corner close so it cannot collide with the panel header', () => {
      // Paired deliberately with the close-button tests above: `hide-close` is only defensible
      // because this component supplies its own close.
      const content = mountSheet().get('[data-testid="sheet-content"]')

      expect(Object.keys(content.attributes())).toContain('hide-close')
      expect(content.attributes('side')).toBe('bottom')
    })
  })
})
