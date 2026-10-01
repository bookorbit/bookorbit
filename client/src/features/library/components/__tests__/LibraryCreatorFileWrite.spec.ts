import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import LibraryCreatorFileWrite from '../LibraryCreatorFileWrite.vue'

describe('LibraryCreatorFileWrite', () => {
  function mountComponent(props: Record<string, unknown> = {}) {
    return mount(LibraryCreatorFileWrite, {
      props: {
        fileRenameEnabled: false,
        fileWriteEnabled: false,
        fileWriteWriteCover: false,
        fileWriteEpubEnabled: false,
        fileWriteEpubMaxFileSizeMb: 100,
        fileWriteFb2Enabled: false,
        fileWriteFb2MaxFileSizeMb: 100,
        fileWritePdfEnabled: false,
        fileWritePdfMaxFileSizeMb: 100,
        fileWriteCbxEnabled: false,
        fileWriteCbxMaxFileSizeMb: 500,
        fileWriteKindleEnabled: false,
        fileWriteKindleMaxFileSizeMb: 100,
        fileWriteAudioEnabled: false,
        fileWriteAudioMaxFileSizeMb: 500,
        ...props,
      },
    })
  }

  const ALL_ENABLED = {
    fileRenameEnabled: true,
    fileWriteEnabled: true,
    fileWriteWriteCover: true,
    fileWriteEpubEnabled: true,
    fileWriteEpubMaxFileSizeMb: 10,
    fileWriteFb2Enabled: true,
    fileWriteFb2MaxFileSizeMb: 60,
    fileWritePdfEnabled: true,
    fileWritePdfMaxFileSizeMb: 20,
    fileWriteCbxEnabled: true,
    fileWriteCbxMaxFileSizeMb: 30,
    fileWriteKindleEnabled: true,
    fileWriteKindleMaxFileSizeMb: 50,
    fileWriteAudioEnabled: true,
    fileWriteAudioMaxFileSizeMb: 40,
  }

  function checkbox(wrapper: ReturnType<typeof mountComponent>, label: string) {
    const control = wrapper.findAll('input[type="checkbox"]').find((node) => node.attributes('aria-label') === label)
    if (!control) throw new Error(`no checkbox labelled "${label}"`)
    return control
  }

  it('emits the two switches and hides the per-format table while writing is off', async () => {
    const wrapper = mountComponent()

    expect(wrapper.text()).toContain('Rename files after metadata changes')
    expect(wrapper.text()).not.toContain('Include cover image')
    const switches = wrapper.findAll('[role="switch"]')
    expect(switches).toHaveLength(2)

    await switches[0]!.trigger('click')
    await switches[1]!.trigger('click')
    expect(wrapper.emitted('update:fileRenameEnabled')).toEqual([[true]])
    expect(wrapper.emitted('update:fileWriteEnabled')).toEqual([[true]])
  })

  it('emits an update for every format checkbox', async () => {
    const wrapper = mountComponent(ALL_ENABLED)

    await checkbox(wrapper, 'Write EPUB metadata').setValue(false)
    await checkbox(wrapper, 'Write FB2 metadata').setValue(false)
    await checkbox(wrapper, 'Write PDF metadata').setValue(false)
    await checkbox(wrapper, 'Write comic archive metadata').setValue(false)
    await checkbox(wrapper, 'Write Kindle metadata').setValue(false)
    await checkbox(wrapper, 'Write audio covers').setValue(false)

    expect(wrapper.emitted('update:fileWriteEpubEnabled')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWriteFb2Enabled')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWritePdfEnabled')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWriteCbxEnabled')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWriteKindleEnabled')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWriteAudioEnabled')).toEqual([[false]])
  })

  it('emits max-size updates for every format', async () => {
    const wrapper = mountComponent(ALL_ENABLED)

    expect(wrapper.findAll('input[type="number"]')).toHaveLength(6)

    await wrapper.find('#epub-max-size').setValue('15')
    await wrapper.find('#fb2-max-size').setValue('65')
    await wrapper.find('#pdf-max-size').setValue('25')
    await wrapper.find('#cbx-max-size').setValue('35')
    await wrapper.find('#kindle-max-size').setValue('55')
    await wrapper.find('#audio-max-size').setValue('45')

    expect(wrapper.emitted('update:fileWriteEpubMaxFileSizeMb')).toEqual([[15]])
    expect(wrapper.emitted('update:fileWriteFb2MaxFileSizeMb')).toEqual([[65]])
    expect(wrapper.emitted('update:fileWritePdfMaxFileSizeMb')).toEqual([[25]])
    expect(wrapper.emitted('update:fileWriteCbxMaxFileSizeMb')).toEqual([[35]])
    expect(wrapper.emitted('update:fileWriteKindleMaxFileSizeMb')).toEqual([[55]])
    expect(wrapper.emitted('update:fileWriteAudioMaxFileSizeMb')).toEqual([[45]])
  })

  it('keeps a size limit visible but disabled while its format is off', () => {
    const wrapper = mountComponent({ fileWriteEnabled: true, fileWriteFb2Enabled: false })

    expect(wrapper.text()).toContain('FictionBook (FB2)')
    expect(wrapper.get('#fb2-max-size').attributes('disabled')).toBeDefined()
    expect(wrapper.get('#fb2-max-size').attributes('aria-label')).toBe('FictionBook (FB2) size limit in MB')
  })

  it('explains why audio is unavailable without the cover image', () => {
    const wrapper = mountComponent({ fileWriteEnabled: true, fileWriteWriteCover: false, fileWriteAudioEnabled: true })

    const audio = checkbox(wrapper, 'Write audio covers')
    expect(audio.attributes('disabled')).toBeDefined()
    expect((audio.element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.text()).toContain('Needs “Include cover image” turned on.')
  })

  it('disables audio embedding when cover writing is turned off', async () => {
    const wrapper = mountComponent({ fileWriteEnabled: true, fileWriteWriteCover: true, fileWriteAudioEnabled: true })

    await wrapper.findAll('input[type="checkbox"]')[0]!.setValue(false)

    expect(wrapper.emitted('update:fileWriteWriteCover')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWriteAudioEnabled')).toEqual([[false]])
  })

  it('counts the books each writer would touch when counts are known', () => {
    const wrapper = mountComponent({ fileWriteEnabled: true, formatCounts: { mobi: 24, azw3: 35, epub: 378 } })

    const kindle = wrapper.findAll('li').find((row) => row.text().includes('Kindle'))!
    expect(kindle.text()).toContain('59')
  })
})
