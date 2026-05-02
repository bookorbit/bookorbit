import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import KeyboardShortcutOverlay from '../KeyboardShortcutOverlay.vue'

describe('KeyboardShortcutOverlay', () => {
  it('does not render when closed', () => {
    const wrapper = mount(KeyboardShortcutOverlay, { props: { open: false } })

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('renders dialog when open', () => {
    const wrapper = mount(KeyboardShortcutOverlay, {
      props: { open: true },
      global: { stubs: { Teleport: true } },
    })

    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Keyboard Shortcuts')
  })

  it('shows navigation shortcuts', () => {
    const wrapper = mount(KeyboardShortcutOverlay, {
      props: { open: true },
      global: { stubs: { Teleport: true } },
    })

    expect(wrapper.text()).toContain('Move focus up/down')
    expect(wrapper.text()).toContain('Move focus left/right')
    expect(wrapper.text()).toContain('Jump to first column')
  })

  it('shows action shortcuts', () => {
    const wrapper = mount(KeyboardShortcutOverlay, {
      props: { open: true },
      global: { stubs: { Teleport: true } },
    })

    expect(wrapper.text()).toContain('Edit focused cell')
    expect(wrapper.text()).toContain('Cancel editing')
    expect(wrapper.text()).toContain('Toggle row selection')
    expect(wrapper.text()).toContain('Copy cell value')
  })

  it('shows help shortcut', () => {
    const wrapper = mount(KeyboardShortcutOverlay, {
      props: { open: true },
      global: { stubs: { Teleport: true } },
    })

    expect(wrapper.text()).toContain('Toggle this help overlay')
  })

  it('emits update:open false when close button clicked', async () => {
    const wrapper = mount(KeyboardShortcutOverlay, {
      props: { open: true },
      global: { stubs: { Teleport: true } },
    })

    const closeButton = wrapper.find('button')
    await closeButton.trigger('click')

    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })

  it('emits update:open false on backdrop click', async () => {
    const wrapper = mount(KeyboardShortcutOverlay, {
      props: { open: true },
      global: { stubs: { Teleport: true } },
    })

    const backdrop = wrapper.find('.fixed')
    await backdrop.trigger('click')

    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })

  it('renders kbd elements for shortcuts', () => {
    const wrapper = mount(KeyboardShortcutOverlay, {
      props: { open: true },
      global: { stubs: { Teleport: true } },
    })

    const kbds = wrapper.findAll('kbd')
    expect(kbds.length).toBeGreaterThan(5)
  })

  it('includes section headers', () => {
    const wrapper = mount(KeyboardShortcutOverlay, {
      props: { open: true },
      global: { stubs: { Teleport: true } },
    })

    const headers = wrapper.findAll('h3')
    const headerTexts = headers.map((h) => h.text())
    expect(headerTexts).toContain('Navigation')
    expect(headerTexts).toContain('Actions')
    expect(headerTexts).toContain('General')
  })
})
