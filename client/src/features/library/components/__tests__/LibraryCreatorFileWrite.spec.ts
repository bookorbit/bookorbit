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
        fileWritePdfEnabled: false,
        fileWritePdfMaxFileSizeMb: 100,
        fileWriteCbxEnabled: false,
        fileWriteCbxMaxFileSizeMb: 500,
        fileWriteAudioEnabled: false,
        fileWriteAudioMaxFileSizeMb: 500,
        ...props,
      },
    })
  }

  it('emits rename toggle updates and hides file-write detail controls when disabled', async () => {
    const wrapper = mountComponent()

    expect(wrapper.text()).toContain('Rename files on metadata update')
    expect(wrapper.text()).not.toContain('Include cover image')

    const renameSwitch = wrapper.findAll('[role="switch"]')[0]
    expect(renameSwitch).toBeDefined()
    await renameSwitch!.trigger('click')
    expect(wrapper.emitted('update:fileRenameEnabled')).toEqual([[true]])
  })

  it('emits file-write toggles and max-size updates when advanced controls are visible', async () => {
    const wrapper = mountComponent({
      fileRenameEnabled: true,
      fileWriteEnabled: true,
      fileWriteWriteCover: true,
      fileWriteEpubEnabled: true,
      fileWriteEpubMaxFileSizeMb: 10,
      fileWritePdfEnabled: true,
      fileWritePdfMaxFileSizeMb: 20,
      fileWriteCbxEnabled: true,
      fileWriteCbxMaxFileSizeMb: 30,
      fileWriteAudioEnabled: true,
      fileWriteAudioMaxFileSizeMb: 40,
    })

    const switches = wrapper.findAll('[role="switch"]')
    expect(switches).toHaveLength(7)
    await switches[1]!.trigger('click')
    await switches[2]!.trigger('click')
    await switches[3]!.trigger('click')
    await switches[4]!.trigger('click')
    await switches[5]!.trigger('click')
    await switches[6]!.trigger('click')

    const inputs = wrapper.findAll('input[type="number"]')
    expect(inputs).toHaveLength(4)
    await inputs[0]!.setValue('15')
    await inputs[1]!.setValue('25')
    await inputs[2]!.setValue('35')
    await inputs[3]!.setValue('45')
    expect(wrapper.emitted('update:fileWriteEnabled')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWriteWriteCover')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWriteEpubEnabled')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWritePdfEnabled')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWriteCbxEnabled')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWriteAudioEnabled')).toEqual([[false], [false]])
    expect(wrapper.emitted('update:fileWriteEpubMaxFileSizeMb')).toEqual([[15]])
    expect(wrapper.emitted('update:fileWritePdfMaxFileSizeMb')).toEqual([[25]])
    expect(wrapper.emitted('update:fileWriteCbxMaxFileSizeMb')).toEqual([[35]])
    expect(wrapper.emitted('update:fileWriteAudioMaxFileSizeMb')).toEqual([[45]])
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
