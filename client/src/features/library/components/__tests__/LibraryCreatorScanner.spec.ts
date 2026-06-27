import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import LibraryCreatorScanner from '../LibraryCreatorScanner.vue'

const tooltipStubs = {
  Tooltip: { template: '<div><slot /></div>' },
  TooltipTrigger: { template: '<div><slot /></div>' },
  TooltipContent: { template: '<div><slot /></div>' },
}

function mountScanner(overrides: Partial<InstanceType<typeof LibraryCreatorScanner>['$props']> = {}) {
  return mount(LibraryCreatorScanner, {
    props: {
      organizationMode: 'book_per_folder',
      organizationModeLocked: false,
      allowedFormats: [],
      excludePatterns: [],
      ...overrides,
    },
    global: {
      stubs: tooltipStubs,
    },
  })
}

describe('LibraryCreatorScanner', () => {
  it('emits organization mode changes while creating a library', async () => {
    const wrapper = mountScanner()

    await wrapper.findAll('button')[1]!.trigger('click')

    expect(wrapper.emitted('update:organizationMode')).toEqual([['book_per_file']])
  })

  it('disables organization mode changes when locked', async () => {
    const wrapper = mountScanner({ organizationModeLocked: true })
    const modeButtons = wrapper.findAll('button').slice(0, 2)

    expect(modeButtons).toHaveLength(2)
    expect(modeButtons.every((button) => button.attributes('disabled') !== undefined)).toBe(true)
    expect(wrapper.text()).toContain('Organization mode is fixed after library creation')

    await modeButtons[1]!.trigger('click')

    expect(wrapper.emitted('update:organizationMode')).toBeUndefined()
  })
})
