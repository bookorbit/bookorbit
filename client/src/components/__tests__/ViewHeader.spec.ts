import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ViewHeader from '../ViewHeader.vue'

const stubs = {
  AppIcon: { template: '<span />' },
  Button: { template: '<button type="button"><slot /></button>' },
  Popover: { template: '<div><slot /></div>' },
  PopoverTrigger: { template: '<div><slot /></div>' },
  PopoverContent: { template: '<div><slot /></div>' },
  Sheet: { template: '<div><slot /></div>' },
  SheetContent: { template: '<div><slot /></div>' },
  SheetDescription: { template: '<div><slot /></div>' },
  SheetHeader: { template: '<div><slot /></div>' },
  SheetTitle: { template: '<div><slot /></div>' },
  Tooltip: { template: '<div><slot /></div>' },
  TooltipTrigger: { template: '<div><slot /></div>' },
  TooltipContent: { template: '<div data-testid="tooltip-content"><slot /></div>' },
  ViewHeaderDisplayControls: { template: '<div />' },
  ViewHeaderMobileMenu: { template: '<div />' },
  ViewHeaderMobileSearchSheet: { template: '<div />' },
}

function mountHeader() {
  return mount(ViewHeader, {
    props: {
      title: 'Library',
      total: 12,
      coverSize: 120,
      gridGap: 16,
      viewMode: 'grid',
    },
    global: { stubs },
  })
}

describe('ViewHeader icon controls', () => {
  it('provides matching labels and tooltips for view modes and display settings', () => {
    const wrapper = mountHeader()

    for (const label of ['Grid view', 'List view', 'Table view', 'Display']) {
      expect(wrapper.get(`button[aria-label="${label}"]`)).toBeTruthy()
      expect(wrapper.findAll('[data-testid="tooltip-content"]').some((content) => content.text() === label)).toBe(true)
    }
  })

  it('keeps view-mode buttons interactive through the tooltip trigger', async () => {
    const wrapper = mountHeader()

    await wrapper.get('button[aria-label="List view"]').trigger('click')

    expect(wrapper.emitted('update:viewMode')).toEqual([['list']])
  })
})
