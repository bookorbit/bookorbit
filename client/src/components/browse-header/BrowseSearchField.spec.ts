import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import BrowseSearchField from './BrowseSearchField.vue'

const passthrough = { template: '<div><slot /></div>' }
const stubs = {
  DropdownMenu: passthrough,
  DropdownMenuTrigger: passthrough,
  DropdownMenuContent: passthrough,
  DropdownMenuItem: { template: '<button type="button" class="menu-item" @click="$emit(\'click\')"><slot /></button>', emits: ['click'] },
}

const tokens = [
  { index: 0, field: 'Read Status', operator: 'is', value: 'Unread' },
  { index: 2, field: 'Language', operator: 'is', value: 'en' },
]

function mountField(props: Record<string, unknown> = {}) {
  return mount(BrowseSearchField, {
    attachTo: document.body,
    props: { modelValue: '', placeholder: 'Search title, author, series, narrator...', ...props },
    global: { stubs },
  })
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('BrowseSearchField', () => {
  it('shows each filter rule as a removable token and reports its root position', async () => {
    const wrapper = mountField({ tokens, active: true })

    expect(wrapper.text()).toContain('Read Status')
    expect(wrapper.text()).toContain('Unread')
    const remove = wrapper.findAll('button[aria-label^="Remove filter"]')
    expect(remove).toHaveLength(2)
    expect(remove[1]!.attributes('aria-label')).toBe('Remove filter Language is en')

    await remove[1]!.trigger('click')
    expect(wrapper.emitted('remove-token')).toEqual([[2]])
    wrapper.unmount()
  })

  it('swaps the long placeholder for a short one once tokens take the room', () => {
    expect(mountField().get('input').attributes('placeholder')).toBe('Search title, author, series, narrator...')
    expect(mountField({ tokens }).get('input').attributes('placeholder')).toBe('Search')
  })

  it('clears search and filters together from one button, shown only while something narrows the view', async () => {
    const idle = mountField()
    expect(idle.find('button[aria-label="Clear search and filters"]').exists()).toBe(false)
    expect(idle.find('kbd').text()).toBe('/')

    const active = mountField({ active: true })
    await active.get('button[aria-label="Clear search and filters"]').trigger('click')
    expect(active.emitted('clear')).toHaveLength(1)
  })

  it('offers saving only when there are tokens to save', async () => {
    expect(mountField({ canSaveAsSmartScope: true, canSaveFilter: true }).find('.menu-item').exists()).toBe(false)

    const wrapper = mountField({ tokens, canSaveAsSmartScope: true, canSaveFilter: true })
    const items = wrapper.findAll('.menu-item')
    expect(items.map((item) => item.text())).toEqual(['Save as Smart Scope', 'Save filter'])
    await items[0]!.trigger('click')
    await items[1]!.trigger('click')
    expect(wrapper.emitted('save-as-smart-scope')).toHaveLength(1)
    expect(wrapper.emitted('save-filter')).toHaveLength(1)
  })

  it('focuses on "/" from the page but not while the reader is typing somewhere else', () => {
    const wrapper = mountField()
    const input = wrapper.get('input').element as HTMLInputElement
    Object.defineProperty(input, 'offsetParent', { configurable: true, get: () => document.body })

    const other = document.createElement('textarea')
    document.body.appendChild(other)
    other.focus()
    other.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(other)

    other.blur()
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(input)
    wrapper.unmount()
  })

  it('stops listening for "/" once it is unmounted', () => {
    const wrapper = mountField()
    const input = wrapper.get('input').element as HTMLInputElement
    wrapper.unmount()

    const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })
    document.body.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(document.activeElement).not.toBe(input)
  })
})
