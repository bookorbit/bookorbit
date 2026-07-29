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

  it('emits rename toggle updates and hides file-write detail controls when disabled', async () => {
    const wrapper = mountComponent()

    expect(wrapper.text()).toContain('Rename files after metadata changes')
    expect(wrapper.text()).not.toContain('Include cover image')

    const renameSwitch = wrapper.findAll('[role="switch"]')[0]
    expect(renameSwitch).toBeDefined()
    await renameSwitch!.trigger('click')
    expect(wrapper.emitted('update:fileRenameEnabled')).toEqual([[true]])
  })

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

  function toggleByLabel(wrapper: ReturnType<typeof mountComponent>, label: string) {
    const control = wrapper.findAll('[role="switch"]').find((node) => node.attributes('aria-label') === label)
    if (!control) throw new Error(`no switch labelled "${label}"`)
    return control.trigger('click')
  }

  it('emits an update for every format toggle', async () => {
    const wrapper = mountComponent(ALL_ENABLED)

    expect(wrapper.findAll('[role="switch"]')).toHaveLength(9)

    await toggleByLabel(wrapper, 'Write metadata to files')
    await toggleByLabel(wrapper, 'Write EPUB metadata')
    await toggleByLabel(wrapper, 'Write FB2 metadata')
    await toggleByLabel(wrapper, 'Write PDF metadata')
    await toggleByLabel(wrapper, 'Write comic archive metadata')
    await toggleByLabel(wrapper, 'Write Kindle metadata')
    await toggleByLabel(wrapper, 'Write audio covers')

    expect(wrapper.emitted('update:fileWriteEnabled')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWriteEpubEnabled')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWriteFb2Enabled')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWritePdfEnabled')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWriteCbxEnabled')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWriteKindleEnabled')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWriteAudioEnabled')).toEqual([[false]])
  })

  it('emits max-size updates for every format', async () => {
    const wrapper = mountComponent(ALL_ENABLED)

    const inputs = wrapper.findAll('input[type="number"]')
    expect(inputs).toHaveLength(6)

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

  it('hides the FB2 size input until the FB2 toggle is on', () => {
    const off = mountComponent({ fileWriteEnabled: true, fileWriteFb2Enabled: false })
    expect(off.text()).toContain('FictionBook (FB2)')
    expect(off.find('#fb2-max-size').exists()).toBe(false)

    const on = mountComponent({ fileWriteEnabled: true, fileWriteFb2Enabled: true })
    expect(on.find('#fb2-max-size').exists()).toBe(true)
    expect(on.find('#fb2-max-size').attributes('value')).toBe('100')
  })

  it('shows FB2 controls independently of the cover-writing toggle', () => {
    const wrapper = mountComponent({ fileWriteEnabled: true, fileWriteWriteCover: false, fileWriteFb2Enabled: true })

    expect(wrapper.text()).toContain('FictionBook (FB2)')
    expect(wrapper.find('#fb2-max-size').exists()).toBe(true)
  })

  it('hides the FB2 card until file writing is enabled', () => {
    expect(mountComponent({ fileWriteEnabled: false, fileWriteFb2Enabled: true }).text()).not.toContain('FictionBook (FB2)')
  })

  it('hides the Kindle size input until the Kindle toggle is on', () => {
    const off = mountComponent({ fileWriteEnabled: true, fileWriteKindleEnabled: false })
    expect(off.text()).toContain('Kindle (MOBI, AZW3)')
    expect(off.find('#kindle-max-size').exists()).toBe(false)

    const on = mountComponent({ fileWriteEnabled: true, fileWriteKindleEnabled: true })
    expect(on.find('#kindle-max-size').exists()).toBe(true)
  })

  it('shows Kindle controls independently of the cover-writing toggle', () => {
    const wrapper = mountComponent({ fileWriteEnabled: true, fileWriteWriteCover: false, fileWriteKindleEnabled: true })

    expect(wrapper.text()).toContain('Kindle (MOBI, AZW3)')
    expect(wrapper.text()).not.toContain('Audio')
  })

  it('gives the Kindle toggle an accessible label', () => {
    const wrapper = mountComponent({ fileWriteEnabled: true })

    expect(wrapper.findAll('[role="switch"]').some((node) => node.attributes('aria-label') === 'Write Kindle metadata')).toBe(true)
  })

  it('renders audio controls only when file write details and cover writing are enabled', () => {
    const hidden = mountComponent({ fileWriteEnabled: false, fileWriteAudioEnabled: true })
    expect(hidden.text()).not.toContain('Audio')

    const coverDisabled = mountComponent({ fileWriteEnabled: true, fileWriteWriteCover: false, fileWriteAudioEnabled: true })
    expect(coverDisabled.text()).not.toContain('Audio')

    const visible = mountComponent({ fileWriteEnabled: true, fileWriteWriteCover: true, fileWriteAudioEnabled: true })
    expect(visible.text()).toContain('Audio')
    expect(visible.text()).toContain('M4B, M4A, MP3, and FLAC')
  })

  it('disables audio embedding when cover writing is turned off', async () => {
    const wrapper = mountComponent({
      fileWriteEnabled: true,
      fileWriteWriteCover: true,
      fileWriteAudioEnabled: true,
    })

    await wrapper.findAll('[role="switch"]')[2]!.trigger('click')

    expect(wrapper.emitted('update:fileWriteWriteCover')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWriteAudioEnabled')).toEqual([[false]])
  })
})
