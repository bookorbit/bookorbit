import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { ENTITY_CAPABILITIES, type BrowseEntityItem } from '@bookorbit/types'

import EntityDataGrid from '../EntityDataGrid.vue'

function makeItem(id: number | string, overrides: Partial<BrowseEntityItem> = {}): BrowseEntityItem {
  return { id, name: `Entity ${id}`, bookCount: 1, ...overrides }
}

function mountGrid(overrides: Partial<InstanceType<typeof EntityDataGrid>['$props']> = {}) {
  return mount(EntityDataGrid, {
    props: {
      items: [1, 2, 3].map((id) => makeItem(id)),
      selectedIds: new Set<number | string>(),
      capabilities: ENTITY_CAPABILITIES.author,
      isInline: false,
      loading: false,
      density: 'comfortable',
      sortBy: 'name',
      sortOrder: 'asc',
      hasActiveFilters: false,
      ...overrides,
    },
    global: {
      stubs: {
        DropdownMenu: { template: '<div><slot /></div>' },
        DropdownMenuTrigger: { template: '<div><slot /></div>' },
        DropdownMenuContent: { template: '<div><slot /></div>' },
        DropdownMenuItem: { emits: ['click'], template: '<button class="dropdown-item" @click="$emit(\'click\')"><slot /></button>' },
        DropdownMenuSeparator: { template: '<hr />' },
      },
    },
  })
}

function rowCheckboxes(wrapper: ReturnType<typeof mountGrid>) {
  return wrapper.find('table').findAll('tbody input[type="checkbox"]')
}

function headerButton(wrapper: ReturnType<typeof mountGrid>, label: string) {
  return wrapper
    .find('table')
    .findAll('thead button')
    .find((button) => button.text().trim() === label)!
}

describe('EntityDataGrid', () => {
  it('emits the checkbox click event so Shift-click selection can be handled by the parent', async () => {
    const wrapper = mountGrid()

    await rowCheckboxes(wrapper)[2]!.trigger('click', { shiftKey: true })

    const selectEvent = wrapper.emitted('select')?.[0]
    expect(selectEvent?.[0]).toBe(3)
    expect((selectEvent?.[1] as MouseEvent | undefined)?.shiftKey).toBe(true)
  })

  it('still emits ordinary checkbox clicks without Shift pressed', async () => {
    const wrapper = mountGrid()

    await rowCheckboxes(wrapper)[0]!.trigger('click')

    const selectEvent = wrapper.emitted('select')?.[0]
    expect(selectEvent?.[0]).toBe(1)
    expect((selectEvent?.[1] as MouseEvent | undefined)?.shiftKey).toBe(false)
  })

  it('emits toggleAll when the header checkbox is switched on and off', async () => {
    const wrapper = mountGrid()
    const selectAll = wrapper.find('table thead input[type="checkbox"]')

    await selectAll.setValue(true)
    await selectAll.setValue(false)

    expect(wrapper.emitted('toggleAll')).toEqual([[true], [false]])
  })

  it('marks the header checkbox as checked only when every row on the page is selected', () => {
    const allSelected = mountGrid({ selectedIds: new Set([1, 2, 3]) })
    const someSelected = mountGrid({ selectedIds: new Set([1]) })

    expect((allSelected.find('table thead input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true)
    expect((someSelected.find('table thead input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false)
  })

  it('flips the sort order when the already active column is clicked again', async () => {
    const wrapper = mountGrid({ sortBy: 'name', sortOrder: 'asc' })

    await headerButton(wrapper, 'Name').trigger('click')

    expect(wrapper.emitted('sortChange')?.[0]).toEqual(['name', 'desc'])
  })

  it('starts a new book count sort on the most useful direction', async () => {
    const wrapper = mountGrid({ sortBy: 'name', sortOrder: 'asc' })

    await headerButton(wrapper, 'Books').trigger('click')

    expect(wrapper.emitted('sortChange')?.[0]).toEqual(['bookCount', 'desc'])
  })

  it('exposes the active sort direction to assistive technology', () => {
    const wrapper = mountGrid({ sortBy: 'bookCount', sortOrder: 'desc' })
    const headers = wrapper.find('table').findAll('thead th')

    expect(headers.map((header) => header.attributes('aria-sort'))).toContain('descending')
  })

  it('hides the sort name column for entity types without sort names', () => {
    const withSortName = mountGrid({ capabilities: ENTITY_CAPABILITIES.author })
    const withoutSortName = mountGrid({ capabilities: ENTITY_CAPABILITIES.genre })

    expect(withSortName.find('table').text()).toContain('Sort name')
    expect(withoutSortName.find('table').text()).not.toContain('Sort name')
  })

  it('hides the status column for inline entity types that cannot be empty', () => {
    const wrapper = mountGrid({ isInline: true, capabilities: ENTITY_CAPABILITIES.publisher })

    expect(wrapper.find('table').text()).not.toContain('Status')
  })

  it('flags entities that are not linked to any book', () => {
    const wrapper = mountGrid({ items: [makeItem(1, { bookCount: 0 })] })

    expect(wrapper.find('table').text()).toContain('No books')
  })

  it('does not offer split for entity types that cannot be split', () => {
    const splittable = mountGrid({ capabilities: ENTITY_CAPABILITIES.author })
    const notSplittable = mountGrid({ capabilities: ENTITY_CAPABILITIES.series })

    expect(splittable.find('table').find('[aria-label="Split"]').exists()).toBe(true)
    expect(notSplittable.find('table').find('[aria-label="Split"]').exists()).toBe(false)
  })

  it('emits row action events', async () => {
    const item = makeItem(7)
    const wrapper = mountGrid({ items: [item] })
    const table = wrapper.find('table')

    await table.find('[aria-label="Rename"]').trigger('click')
    await table.find('[aria-label="Split"]').trigger('click')
    await table.find('[aria-label="Delete"]').trigger('click')

    expect(wrapper.emitted('rename')?.[0]).toEqual([item])
    expect(wrapper.emitted('split')?.[0]).toEqual([item])
    expect(wrapper.emitted('delete')?.[0]).toEqual([item])
  })

  it('emits row action events from the mobile menu', async () => {
    const item = makeItem(1)
    const wrapper = mountGrid({ items: [item] })

    const dropdownItems = wrapper.findAll('.dropdown-item')
    await dropdownItems[0]!.trigger('click')
    await dropdownItems[1]!.trigger('click')
    await dropdownItems[2]!.trigger('click')

    expect(wrapper.emitted('rename')?.[0]).toEqual([item])
    expect(wrapper.emitted('split')?.[0]).toEqual([item])
    expect(wrapper.emitted('delete')?.[0]).toEqual([item])
  })

  it('shows the loading state', () => {
    expect(mountGrid({ loading: true }).text()).toContain('Loading')
  })

  it('distinguishes an empty entity type from an over-filtered result', () => {
    expect(mountGrid({ items: [], hasActiveFilters: false }).text()).toContain('No entities found')
    expect(mountGrid({ items: [], hasActiveFilters: true }).text()).toContain('No matches')
  })

  it('offers to clear filters only when filters are actually narrowing the result', async () => {
    const unfiltered = mountGrid({ items: [], hasActiveFilters: false })
    const filtered = mountGrid({ items: [], hasActiveFilters: true })

    expect(unfiltered.text()).not.toContain('Clear filters')

    await filtered.find('table').findAll('button').at(-1)!.trigger('click')
    expect(filtered.emitted('clearFilters')).toHaveLength(1)
  })
})
