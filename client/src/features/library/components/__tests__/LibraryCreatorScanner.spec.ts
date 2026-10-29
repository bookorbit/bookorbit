import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { BOOK_FORMATS, FOLDER_SERIES_REGEX_METADATA } from '@bookorbit/types'

import LibraryCreatorScanner from '../LibraryCreatorScanner.vue'

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

  it('allows DjVu to be selected when imports are restricted to specific formats', async () => {
    const wrapper = mountScanner({ allowedFormats: ['pdf'] })
    await wrapper
      .findAll('button[aria-pressed]')
      .find((button) => button.text() === 'DJVU')!
      .trigger('click')
    expect(wrapper.emitted('update:allowedFormats')).toEqual([[['pdf', 'djvu']]])
    wrapper.unmount()
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

  it('offers series folders as a third layout that sets File as Book with folders as series', async () => {
    const wrapper = mountScanner()
    const layouts = wrapper.findAll('input[name="organization-mode"]').map((input) => (input.element as HTMLInputElement).value)
    expect(layouts).toEqual(['book_per_folder', 'book_per_file', 'series_folders'])
    expect(wrapper.text()).toContain('Uses File as Book')

    await wrapper.get('input[name="organization-mode"][value="series_folders"]').setValue()

    expect(wrapper.emitted('update:organizationMode')).toEqual([['book_per_file']])
    expect(wrapper.emitted('update:regexMetadata')).toEqual([[FOLDER_SERIES_REGEX_METADATA]])
  })

  it('shows series folders as the chosen layout while File as Book uses the folder rules', async () => {
    const wrapper = mountScanner({ organizationMode: 'book_per_file', regexMetadata: FOLDER_SERIES_REGEX_METADATA })
    const checked = wrapper.get('input[name="organization-mode"]:checked').element as HTMLInputElement
    expect(checked.value).toBe('series_folders')

    await wrapper.get('input[name="organization-mode"][value="book_per_file"]').setValue()

    expect(wrapper.emitted('update:organizationMode')).toBeUndefined()
    expect(wrapper.emitted('update:regexMetadata')).toEqual([[null]])
  })

  it('drops the folder rules when switching to Folder as Book, where the folder is the book', async () => {
    const wrapper = mountScanner({ organizationMode: 'book_per_file', regexMetadata: FOLDER_SERIES_REGEX_METADATA })

    await wrapper.get('input[name="organization-mode"][value="book_per_folder"]').setValue()

    expect(wrapper.emitted('update:organizationMode')).toEqual([['book_per_folder']])
    expect(wrapper.emitted('update:regexMetadata')).toEqual([[null]])
  })

  it('keeps custom path rules when switching between book layouts', async () => {
    const custom = { rules: [{ pattern: '(?<series>[^/]+)/', flags: '' }] }
    const wrapper = mountScanner({ organizationMode: 'book_per_file', regexMetadata: custom })

    await wrapper.get('input[name="organization-mode"][value="book_per_folder"]').setValue()

    expect(wrapper.emitted('update:regexMetadata')).toBeUndefined()
  })

  it('offers folders as series, in its own card, only when every file is its own book', async () => {
    expect(mountScanner().find('#series-card-title').exists()).toBe(false)

    const wrapper = mountScanner({ organizationMode: 'book_per_file' })
    const toggle = wrapper.get('[aria-labelledby="folder-series-title"]')
    expect(wrapper.get('#series-card-title').text()).toBe('Series')
    expect(toggle.attributes('aria-checked')).toBe('false')
    expect(wrapper.text()).toContain('so each folder names the series of the files inside it')

    await toggle.trigger('click')

    expect(wrapper.emitted('update:regexMetadata')).toEqual([[FOLDER_SERIES_REGEX_METADATA]])
  })

  it('shows the series-folder layout in the Series card once the library exists, and turns it off', async () => {
    const wrapper = mountScanner({ organizationMode: 'book_per_file', organizationModeLocked: true, regexMetadata: FOLDER_SERIES_REGEX_METADATA })
    const card = wrapper.get('#series-card-title').element.closest('section')!
    const toggle = wrapper.get('[aria-labelledby="folder-series-title"]')

    expect(toggle.attributes('aria-checked')).toBe('true')
    expect(card.textContent).toContain('Saga #01.cbz')
    expect(wrapper.text()).toContain('Each folder becomes a series')
    expect(wrapper.text()).toContain('Books already in this library get these series')

    await toggle.trigger('click')
    expect(wrapper.emitted('update:regexMetadata')).toEqual([[null]])
  })

  it('describes File as Book as covering series folders once the library exists', () => {
    const wrapper = mountScanner({ organizationMode: 'book_per_file', organizationModeLocked: true })

    expect(wrapper.text()).toContain('Best for comics and manga kept in one folder per series')
  })

  it('warns that turning folders as series on replaces custom path rules', () => {
    const wrapper = mountScanner({ organizationMode: 'book_per_file', regexMetadata: { rules: [{ pattern: '(?<series>[^/]+)/', flags: '' }] } })

    expect(wrapper.get('[aria-labelledby="folder-series-title"]').attributes('aria-checked')).toBe('false')
    expect(wrapper.text()).toContain('replaces the path rules set under Metadata')
  })

  it('keeps the custom rules that Series folders replaced and brings them back when it is left', async () => {
    const custom = { rules: [{ pattern: '(?<series>[^/]+)/', flags: '' }] }
    const wrapper = mountScanner({ organizationMode: 'book_per_file', regexMetadata: custom })

    await wrapper.get('input[name="organization-mode"][value="series_folders"]').setValue()
    expect(wrapper.emitted('update:replacedRegexMetadata')).toEqual([[custom]])
    expect(wrapper.emitted('update:regexMetadata')).toEqual([[FOLDER_SERIES_REGEX_METADATA]])

    await wrapper.setProps({ regexMetadata: FOLDER_SERIES_REGEX_METADATA, replacedRegexMetadata: custom })
    await wrapper.get('[aria-labelledby="folder-series-title"]').trigger('click')

    expect(wrapper.emitted('update:regexMetadata')![1]).toEqual([custom])
    expect(wrapper.emitted('update:replacedRegexMetadata')![1]).toEqual([null])
  })
})
