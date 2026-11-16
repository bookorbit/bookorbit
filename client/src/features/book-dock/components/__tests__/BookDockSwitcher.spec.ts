import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import BookDockSwitcher, { type BookDockSwitcherTab } from '../BookDockSwitcher.vue'

const tabs: BookDockSwitcherTab[] = [
  { key: 'all', label: 'All', total: 9, onHold: 2, error: 1 },
  { key: 'unsorted', label: 'Unsorted', total: 3, onHold: 0, error: 0 },
  { key: 7, label: 'Fiction', total: 4, onHold: 2, error: 0 },
  { key: 8, label: 'Comics', total: 2, onHold: 0, error: 1, off: true },
]

function mountSwitcher(canManage: boolean, current: BookDockSwitcherTab['key'] = 'all') {
  return mount(BookDockSwitcher, {
    props: { tabs, current, canManage },
    global: { stubs: { RouterLink: { template: '<a data-testid="book-dock-switcher-add"><slot /></a>' } } },
  })
}

describe('BookDockSwitcher', () => {
  it('marks the current dock and picks another', async () => {
    const wrapper = mountSwitcher(false, 7)

    expect(wrapper.get('[aria-current="page"]').attributes('data-testid')).toBe('book-dock-switcher-7')
    await wrapper.get('[data-testid="book-dock-switcher-unsorted"]').trigger('click')

    expect(wrapper.emitted('select')).toEqual([['unsorted']])
  })

  it('reads out each count and marks a dock that is off', () => {
    const wrapper = mountSwitcher(false)
    const comics = wrapper.get('[data-testid="book-dock-switcher-8"]')

    expect(comics.text()).toContain('Off')
    expect(comics.get('.sr-only').text()).toBe('2 files, 0 on hold, 1 failed')
  })

  it('offers to add a dock only to someone who manages docks', () => {
    expect(mountSwitcher(false).find('[data-testid="book-dock-switcher-add"]').exists()).toBe(false)
    expect(mountSwitcher(true).find('[data-testid="book-dock-switcher-add"]').exists()).toBe(true)
  })
})
