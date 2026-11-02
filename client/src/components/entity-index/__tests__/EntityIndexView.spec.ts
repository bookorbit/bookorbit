import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import EntityIndexView from '../EntityIndexView.vue'
import type { EntityIndexItem } from '../EntityIndexView.vue'

function mountView(items: EntityIndexItem[]) {
  return mount(EntityIndexView, {
    props: {
      title: 'Libraries',
      titleIcon: 'BookCopy',
      items,
      routeName: 'library',
      fallbackIcon: 'BookCopy',
      searchPlaceholder: 'Filter libraries...',
      emptyTitle: 'No libraries yet',
      emptyHint: 'Create a library to start adding books.',
    },
    global: {
      stubs: {
        RouterLink: { name: 'RouterLink', props: ['to'], template: '<a><slot /></a>' },
        Popover: { name: 'Popover', template: '<div><slot /></div>' },
        PopoverTrigger: { name: 'PopoverTrigger', template: '<button type="button"><slot /></button>' },
        PopoverContent: { name: 'PopoverContent', template: '<div><slot /></div>' },
      },
    },
  })
}

function makeItem(overrides: Partial<EntityIndexItem>): EntityIndexItem {
  return { id: 1, displayOrder: 0, name: 'Library', icon: null, ...overrides }
}

describe('EntityIndexView', () => {
  describe('counts', () => {
    it('describes a library by its book count', () => {
      const wrapper = mountView([makeItem({ bookCount: 7 })])

      expect(wrapper.text()).toContain('Books: 7')
    })

    it('omits the count line for an entity that carries no count', () => {
      const wrapper = mountView([makeItem({ name: 'Scope' })])

      expect(wrapper.text()).not.toContain('Books:')
    })

    it('sorts by book count', async () => {
      const wrapper = mountView([
        makeItem({ id: 1, displayOrder: 0, name: 'Large', bookCount: 9 }),
        makeItem({ id: 2, displayOrder: 1, name: 'Small', bookCount: 2 }),
      ])

      const sortByCount = wrapper.findAll('button').find((button) => button.text() === 'Book count')
      if (!sortByCount) throw new Error('Expected a book count sort option')
      await sortByCount.trigger('click')

      expect(wrapper.findAll('a').map((link) => link.text())).toEqual(['SmallBooks: 2', 'LargeBooks: 9'])
    })
  })
})
