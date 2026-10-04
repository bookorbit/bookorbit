import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { BOOK_FORMATS } from '@bookorbit/types'

import LibraryCreatorScanner from '../LibraryCreatorScanner.vue'

function mountScanner(overrides: Partial<InstanceType<typeof LibraryCreatorScanner>['$props']> = {}) {
  return mount(LibraryCreatorScanner, {
    props: {
      organizationMode: 'book_per_folder',
      organizationModeLocked: false,
      deriveSeriesFromFolder: false,
      allowedFormats: [],
      addedAtSource: 'imported',
      excludePatterns: [],
      ...overrides,
    },
  })
}

describe('LibraryCreatorScanner', () => {
  it('emits organization mode changes while creating a library', async () => {
    const wrapper = mountScanner()

    await wrapper.get('input[name="organization-mode"][value="book_per_file"]').setValue()

    expect(wrapper.emitted('update:organizationMode')).toEqual([['book_per_file']])
    expect(wrapper.text()).toContain('This is the one setting you cannot change later.')
  })

  it('shows only the chosen mode, with the reason it is fixed, once the library exists', () => {
    const wrapper = mountScanner({ organizationModeLocked: true, organizationMode: 'book_per_file' })

    expect(wrapper.find('input[name="organization-mode"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('File as Book')
    expect(wrapper.text()).toContain('Set at creation')
    expect(wrapper.text()).toContain('Organization mode is fixed after library creation')
  })

  it('hides series from folders unless each file is its own book', () => {
    const wrapper = mountScanner({ organizationMode: 'book_per_folder' })

    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
  })

  it('offers series from folders in file mode with a one-line reason', () => {
    const wrapper = mountScanner({ organizationMode: 'book_per_file' })

    const checkbox = wrapper.get('input[type="checkbox"]')
    expect((checkbox.element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.get('#series-from-folders-hint').text()).toBe('Recommended for Komga and Kavita layouts: one folder per series.')
  })

  it('emits series from folders when toggled', async () => {
    const wrapper = mountScanner({ organizationMode: 'book_per_file' })

    await wrapper.get('input[type="checkbox"]').setValue(true)

    expect(wrapper.emitted('update:deriveSeriesFromFolder')).toEqual([[true]])
  })

  it('keeps series from folders adjustable once the organization mode is locked', () => {
    const wrapper = mountScanner({ organizationMode: 'book_per_file', organizationModeLocked: true, deriveSeriesFromFolder: true })

    const checkbox = wrapper.get('input[type="checkbox"]')
    expect(checkbox.attributes('disabled')).toBeUndefined()
    expect((checkbox.element as HTMLInputElement).checked).toBe(true)
  })

  it('starts restricting imports from every format, then drops the ones unticked', async () => {
    const wrapper = mountScanner()

    await wrapper.get('input[name="import-formats"]:not(:checked)').setValue()
    expect(wrapper.emitted('update:allowedFormats')).toEqual([[[...BOOK_FORMATS]]])

    await wrapper.setProps({ allowedFormats: [...BOOK_FORMATS] })
    await wrapper
      .findAll('button[aria-pressed]')
      .find((button) => button.text() === 'PDF')!
      .trigger('click')

    expect(wrapper.emitted('update:allowedFormats')![1]![0]).not.toContain('pdf')
    expect(wrapper.text()).toContain('will be marked as missing on the next scan')
  })

  it('never lets the last imported format be unticked', async () => {
    const wrapper = mountScanner({ allowedFormats: ['epub'] })

    await wrapper
      .findAll('button[aria-pressed]')
      .find((button) => button.text() === 'EPUB')!
      .trigger('click')

    expect(wrapper.emitted('update:allowedFormats')).toBeUndefined()
  })

  it('adds skip patterns on Enter and removes them by name', async () => {
    const wrapper = mountScanner({ excludePatterns: ['**/samples/**'] })

    await wrapper.get('#exclude-pattern-input').setValue('**/extras/**')
    await wrapper.get('#exclude-pattern-input').trigger('keydown', { key: 'Enter' })
    await wrapper.get('button[aria-label="Remove pattern **/samples/**"]').trigger('click')

    expect(wrapper.emitted('update:excludePatterns')).toEqual([[['**/samples/**', '**/extras/**']], [[]]])
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

  it('uses native radios for the date source and exposes partial failures as accessible status', async () => {
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
    const radios = wrapper.findAll('input[name="added-at-source"]')
    expect(radios).toHaveLength(3)
    await radios[1]!.setValue()
    expect(wrapper.emitted('update:addedAtSource')).toEqual([['file_modified']])
    expect(wrapper.get('[role="status"]').text()).toContain('1 failed')
    wrapper.unmount()
  })
})
