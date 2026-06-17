import { describe, expect, it } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { ENTITY_CAPABILITIES, type BrowseEntityItem } from '@bookorbit/types'

import EntityBrowseTable from '../EntityBrowseTable.vue'

function makeItem(id: number | string): BrowseEntityItem {
  return {
    id,
    name: `Entity ${id}`,
    bookCount: 1,
  }
}

function mountTable(overrides: Partial<InstanceType<typeof EntityBrowseTable>['$props']> = {}) {
  return shallowMount(EntityBrowseTable, {
    props: {
      items: [1, 2, 3].map(makeItem),
      total: 3,
      page: 1,
      pageSize: 25,
      totalPages: 1,
      search: '',
      loading: false,
      selectedIds: new Set<number | string>(),
      capabilities: ENTITY_CAPABILITIES.author,
      isInline: false,
      ...overrides,
    },
  })
}

describe('EntityBrowseTable', () => {
  it('emits the checkbox click event so Shift-click selection can be handled by the parent', async () => {
    const wrapper = mountTable()
    const checkbox = wrapper.findAll('input[type="checkbox"]')[2]!

    await checkbox.trigger('click', { shiftKey: true })

    const selectEvent = wrapper.emitted('select')?.[0]
    expect(selectEvent?.[0]).toBe(3)
    expect(selectEvent?.[1]).toBeInstanceOf(MouseEvent)
    expect((selectEvent?.[1] as MouseEvent | undefined)?.shiftKey).toBe(true)
  })

  it('still emits ordinary checkbox clicks without Shift pressed', async () => {
    const wrapper = mountTable()
    const checkbox = wrapper.findAll('input[type="checkbox"]')[0]!

    await checkbox.trigger('click')

    const selectEvent = wrapper.emitted('select')?.[0]
    expect(selectEvent?.[0]).toBe(1)
    expect((selectEvent?.[1] as MouseEvent | undefined)?.shiftKey).toBe(false)
  })
})
