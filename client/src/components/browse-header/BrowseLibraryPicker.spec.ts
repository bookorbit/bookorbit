import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import BrowseLibraryPicker from './BrowseLibraryPicker.vue'

const passthrough = { template: '<div><slot /></div>' }
const stubs = {
  DropdownMenu: passthrough,
  DropdownMenuTrigger: passthrough,
  DropdownMenuContent: passthrough,
  DropdownMenuLabel: { template: '<div data-testid="menu-label"><slot /></div>' },
  DropdownMenuSeparator: { template: '<hr />' },
  DropdownMenuItem: { emits: ['click'], template: '<button type="button" data-testid="item" @click="$emit(\'click\')"><slot /></button>' },
}

const libraries = [
  { id: 1, name: 'Novels', bookCount: 1200 },
  { id: 2, name: 'Comics', bookCount: 34 },
]

function mountPicker(props: Partial<InstanceType<typeof BrowseLibraryPicker>['$props']> = {}) {
  return mount(BrowseLibraryPicker, { props: { libraries, modelValue: null, ...props }, global: { stubs } })
}

/** Each choice as its name, plus its count when one is shown. */
function itemTexts(wrapper: ReturnType<typeof mountPicker>) {
  return wrapper.findAll('[data-testid="item"]').map((item) => {
    const count = item.find('.tabular-nums')
    const name = item
      .text()
      .replace(count.exists() ? count.text() : '', '')
      .trim()
    return count.exists() ? `${name} ${count.text()}` : name
  })
}

describe('BrowseLibraryPicker', () => {
  it('lists the libraries without counts or a heading by default', () => {
    const wrapper = mountPicker()

    expect(wrapper.find('[data-testid="menu-label"]').exists()).toBe(false)
    expect(itemTexts(wrapper)).toEqual(['All Libraries', 'Novels', 'Comics'])
  })

  it('shows a heading and each library count, with their sum beside All Libraries', () => {
    const wrapper = mountPicker({ menuLabel: 'Count books in', showCounts: true })

    expect(wrapper.get('[data-testid="menu-label"]').text()).toBe('Count books in')
    expect(itemTexts(wrapper)).toEqual(['All Libraries 1,234', 'Novels 1,200', 'Comics 34'])
  })

  it('leaves out a count the caller does not have', () => {
    const wrapper = mountPicker({ libraries: [{ id: 3, name: 'PDFs' }], showCounts: true })

    expect(itemTexts(wrapper)).toEqual(['All Libraries 0', 'PDFs'])
  })

  it('emits the picked library, and null for all of them', async () => {
    const wrapper = mountPicker({ modelValue: 1 })
    const items = wrapper.findAll('[data-testid="item"]')

    await items[2]!.trigger('click')
    await items[0]!.trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([[2], [null]])
  })
})
