import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import EntityBrowseToolbar from '../EntityBrowseToolbar.vue'

function mountToolbar(overrides: Partial<InstanceType<typeof EntityBrowseToolbar>['$props']> = {}) {
  return mount(EntityBrowseToolbar, {
    props: {
      search: '',
      bookCount: 'any',
      total: 3,
      density: 'comfortable',
      selectedCount: 0,
      isInline: false,
      ...overrides,
    },
  })
}

describe('EntityBrowseToolbar', () => {
  it('emits search updates from the search input', async () => {
    const wrapper = mountToolbar()

    await wrapper.find('input[type="search"]').setValue('tolkien')

    expect(wrapper.emitted('update:search')?.[0]).toEqual(['tolkien'])
  })

  it('emits book count filter updates from the filter group', async () => {
    const wrapper = mountToolbar({ bookCount: 'any' })

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'No books')!
      .trigger('click')

    expect(wrapper.emitted('update:bookCount')?.[0]).toEqual(['empty'])
  })

  it('emits a reset back to all entities', async () => {
    const wrapper = mountToolbar({ bookCount: 'empty' })

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'All')!
      .trigger('click')

    expect(wrapper.emitted('update:bookCount')?.[0]).toEqual(['any'])
  })

  it('hides the book count filter for inline entity types that cannot be empty', () => {
    expect(mountToolbar({ isInline: true }).text()).not.toContain('No books')
  })

  it('emits density updates', async () => {
    const wrapper = mountToolbar({ density: 'comfortable' })

    await wrapper.find('[aria-label="Compact"]').trigger('click')

    expect(wrapper.emitted('update:density')?.[0]).toEqual(['compact'])
  })

  it('replaces the density control with bulk actions while rows are selected', async () => {
    const wrapper = mountToolbar({ selectedCount: 2 })

    expect(wrapper.find('[aria-label="Compact"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('2 selected')

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Merge')!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Delete')!
      .trigger('click')
    await wrapper.find('[aria-label="Clear"]').trigger('click')

    expect(wrapper.emitted('bulkMerge')).toHaveLength(1)
    expect(wrapper.emitted('bulkDelete')).toHaveLength(1)
    expect(wrapper.emitted('clearSelection')).toHaveLength(1)
  })

  it('only offers merge once at least two entities are selected', () => {
    const single = mountToolbar({ selectedCount: 1 })
    const pair = mountToolbar({ selectedCount: 2 })

    expect(single.findAll('button').some((button) => button.text() === 'Merge')).toBe(false)
    expect(pair.findAll('button').some((button) => button.text() === 'Merge')).toBe(true)
  })
})
