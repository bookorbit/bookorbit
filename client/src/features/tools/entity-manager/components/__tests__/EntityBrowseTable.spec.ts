import { describe, expect, it } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { ENTITY_CAPABILITIES, type BrowseEntityItem } from '@bookorbit/types'

import EntityBrowseTable from '../EntityBrowseTable.vue'

function makeItem(id: number): BrowseEntityItem {
  return { id, name: `Entity ${id}`, bookCount: 1 }
}

function mountTable(overrides: Partial<InstanceType<typeof EntityBrowseTable>['$props']> = {}) {
  return shallowMount(EntityBrowseTable, {
    props: {
      items: [1, 2, 3].map(makeItem),
      total: 3,
      page: 1,
      pageSize: 25,
      totalPages: 1,
      sortBy: 'name',
      sortOrder: 'asc',
      density: 'comfortable',
      loading: false,
      hasActiveFilters: false,
      selectedIds: new Set<number | string>(),
      capabilities: ENTITY_CAPABILITIES.author,
      isInline: false,
      ...overrides,
    },
  })
}

function grid(wrapper: ReturnType<typeof mountTable>) {
  return wrapper.findComponent({ name: 'EntityDataGrid' })
}

describe('EntityBrowseTable', () => {
  it('forwards grid events to the parent', () => {
    const wrapper = mountTable()
    const item = makeItem(4)
    const event = new MouseEvent('click')

    grid(wrapper).vm.$emit('select', 4, event)
    grid(wrapper).vm.$emit('toggleAll', true)
    grid(wrapper).vm.$emit('sortChange', 'bookCount', 'desc')
    grid(wrapper).vm.$emit('rename', item)
    grid(wrapper).vm.$emit('delete', item)
    grid(wrapper).vm.$emit('split', item)
    grid(wrapper).vm.$emit('clearFilters')

    expect(wrapper.emitted('select')?.[0]).toEqual([4, event])
    expect(wrapper.emitted('toggleAll')?.[0]).toEqual([true])
    expect(wrapper.emitted('sortChange')?.[0]).toEqual(['bookCount', 'desc'])
    expect(wrapper.emitted('rename')?.[0]).toEqual([item])
    expect(wrapper.emitted('delete')?.[0]).toEqual([item])
    expect(wrapper.emitted('split')?.[0]).toEqual([item])
    expect(wrapper.emitted('clearFilters')).toHaveLength(1)
  })

  it('forwards pager events to the parent', () => {
    const wrapper = mountTable()
    const pager = wrapper.findComponent({ name: 'EntityBrowsePager' })

    pager.vm.$emit('update:page', 3)
    pager.vm.$emit('update:pageSize', 50)

    expect(wrapper.emitted('update:page')?.[0]).toEqual([3])
    expect(wrapper.emitted('update:pageSize')?.[0]).toEqual([50])
  })

  it('passes the filter state through to the grid empty state', () => {
    expect(grid(mountTable()).props('hasActiveFilters')).toBe(false)
    expect(grid(mountTable({ hasActiveFilters: true })).props('hasActiveFilters')).toBe(true)
  })

  it('leaves search and filter controls to the page toolbar', () => {
    const wrapper = mountTable()

    expect(wrapper.findComponent({ name: 'EntityBrowseToolbar' }).exists()).toBe(false)
    expect(wrapper.find('input[type="search"]').exists()).toBe(false)
  })
})
