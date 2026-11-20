import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import BrowseSearchField from './BrowseSearchField.vue'

const passthrough = { template: '<div><slot /></div>' }
const stubs = {
  DropdownMenu: passthrough,
  DropdownMenuTrigger: passthrough,
  DropdownMenuContent: passthrough,
  DropdownMenuItem: { template: '<button type="button" class="menu-item" @click="$emit(\'click\')"><slot /></button>', emits: ['click'] },
  DropdownMenuRadioGroup: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<div class="radio-group" :data-value="modelValue" @click="$emit(\'update:modelValue\', $event.target.dataset.value)"><slot /></div>',
  },
  DropdownMenuRadioItem: { props: ['value'], template: '<button type="button" class="radio-item" :data-value="value"><slot /></button>' },
}

const tokens = [
  { index: 0, kind: 'rule' as const, field: 'Read Status', operator: 'is', value: 'Unread' },
  { index: 2, kind: 'rule' as const, field: 'Language', operator: 'is', value: 'en' },
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

  it('opens a token for editing and hands over the token itself to anchor the panel', async () => {
    const wrapper = mountField({ tokens, active: true })

    await wrapper.get('button[aria-label="Language is en. Edit"]').trigger('click')

    const [index, element] = wrapper.emitted<[number, HTMLElement]>('edit-token')![0]!
    expect(index).toBe(2)
    expect(element.hasAttribute('data-token')).toBe(true)
    expect(element.textContent).toContain('Language')
    expect(wrapper.emitted('remove-token')).toBeUndefined()
    wrapper.unmount()
  })

  it('shows how the filters combine once there are two, and reports a switch to any', async () => {
    expect(
      mountField({ tokens: [tokens[0]] })
        .find('[data-testid="filter-join-chip"]')
        .exists(),
    ).toBe(false)

    const wrapper = mountField({ tokens, join: 'AND' })
    const chip = wrapper.get('[data-testid="filter-join-chip"]')
    expect(chip.text()).toBe('All')
    expect(chip.attributes('aria-label')).toBe('Matching all filters. Change')

    await wrapper.get('.radio-item[data-value="OR"]').trigger('click')
    expect(wrapper.emitted('set-join')).toEqual([['OR']])

    await wrapper.setProps({ join: 'OR' })
    expect(wrapper.get('[data-testid="filter-join-chip"]').text()).toBe('Any')
  })

  it('moves focus to the summary when the focused token folds away', async () => {
    const wrapper = mountField({ tokens, join: 'AND' })
    const chip = wrapper.get<HTMLButtonElement>('[data-testid="filter-join-chip"]').element
    chip.focus()

    // jsdom has no layout, so the next measure finds no room and folds the tokens.
    await wrapper.setProps({ tokens: tokens.map((token) => ({ ...token })), join: 'OR' })
    await flushPromises()

    const summary = wrapper.findAll('button').find((button) => button.text().includes('2 filters'))
    expect(summary?.element).toBe(document.activeElement)
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
