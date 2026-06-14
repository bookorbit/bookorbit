import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AnnotationToolbar from '../AnnotationToolbar.vue'

const stubs = {
  Popover: { template: '<div><slot /></div>' },
  PopoverTrigger: { template: '<div><slot /></div>' },
  PopoverContent: { template: '<div><slot /></div>' },
  Sheet: { template: '<div><slot /></div>' },
  SheetTrigger: { template: '<div><slot /></div>' },
  SheetContent: { template: '<div><slot /></div>' },
  SheetHeader: { template: '<div><slot /></div>' },
  SheetTitle: { template: '<div><slot /></div>' },
  Badge: { template: '<span><slot /></span>' },
  Button: { template: '<button><slot /></button>' },
}

function mountToolbar(props: Record<string, unknown> = {}) {
  return mount(AnnotationToolbar, {
    props: {
      sortOptions: [
        { value: 'newest', label: 'Newest first' },
        { value: 'oldest', label: 'Oldest first' },
      ],
      filterCount: 0,
      chips: [],
      search: '',
      sortKey: 'newest',
      density: 'comfortable',
      ...props,
    },
    global: { stubs },
  })
}

describe('AnnotationToolbar', () => {
  it('emits search updates', async () => {
    const wrapper = mountToolbar()
    await wrapper.get('input[type="search"]').setValue('dune')
    expect(wrapper.emitted('update:search')!.slice(-1)[0]).toEqual(['dune'])
  })

  it('emits sort-key updates', async () => {
    const wrapper = mountToolbar()
    await wrapper.get('select').setValue('oldest')
    expect(wrapper.emitted('update:sortKey')!.slice(-1)[0]).toEqual(['oldest'])
  })

  it('toggles density from comfortable to compact', async () => {
    const wrapper = mountToolbar({ density: 'comfortable' })
    await wrapper.get('button[aria-label="Switch to compact view"]').trigger('click')
    expect(wrapper.emitted('update:density')!.slice(-1)[0]).toEqual(['compact'])
  })

  it('shows the active filter count', () => {
    expect(mountToolbar({ filterCount: 3 }).text()).toContain('3')
  })

  it('re-emits chip removal and clear-all from the chip row', async () => {
    const wrapper = mountToolbar({ chips: [{ id: 'style', label: 'Style: Underline' }] })
    await wrapper.get('[aria-label="Remove filter Style: Underline"]').trigger('click')
    expect(wrapper.emitted('removeChip')!.slice(-1)[0]).toEqual(['style'])

    const clearAll = wrapper.findAll('button').find((button) => button.text() === 'Clear all')
    await clearAll!.trigger('click')
    expect(wrapper.emitted('clearFilters')).toBeTruthy()
  })
})
