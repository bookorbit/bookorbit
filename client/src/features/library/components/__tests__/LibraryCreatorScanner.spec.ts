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
      addedAtSource: 'imported',
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
  it('enables recompute only for saved file sources and requires confirmation', async () => {
    const wrapper = mountScanner({ addedAtSource: 'file_created', storedAddedAtSource: 'file_created', canRecomputeAddedAt: true })
    const recompute = wrapper.findAll('button').find((button) => button.text() === 'Recompute now')!
    expect(recompute.attributes('disabled')).toBeUndefined()
    await recompute.trigger('click')
    expect(wrapper.emitted('recompute')).toBeUndefined()
    await wrapper.get('[role="group"] button').trigger('click')
    expect(wrapper.emitted('recompute')).toEqual([[]])
    await wrapper.setProps({ addedAtSource: 'file_modified' })
    expect(recompute.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('uses native radios and exposes partial failures as accessible status', async () => {
    const wrapper = mountScanner({
      addedAtSource: 'file_created',
      recomputeJob: {
        id: 'job',
        libraryId: 1,
        source: 'file_created',
        status: 'completed',
        total: 2,
        processed: 2,
        updated: 1,
        unchanged: 0,
        skipped: 0,
        failed: 1,
        failureSamples: [],
      },
    })
    const radios = wrapper.findAll('input[type="radio"]')
    expect(radios).toHaveLength(3)
    await radios[1]!.setValue()
    expect(wrapper.emitted('update:addedAtSource')).toEqual([['file_modified']])
    expect(wrapper.get('[role="status"]').text()).toContain('1 failed')
    wrapper.unmount()
  })
})
