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
    })

    const switches = wrapper.findAll('[role="switch"]')
    expect(switches).toHaveLength(6)
    await switches[1]!.trigger('click')
    await switches[2]!.trigger('click')
    await switches[3]!.trigger('click')
    await switches[4]!.trigger('click')
    await switches[5]!.trigger('click')

    const inputs = wrapper.findAll('input[type="number"]')
    expect(inputs).toHaveLength(3)
    await inputs[0]!.setValue('15')
    await inputs[1]!.setValue('25')
    await inputs[2]!.setValue('35')
    expect(wrapper.emitted('update:fileWriteEnabled')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWriteWriteCover')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWriteEpubEnabled')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWritePdfEnabled')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWriteCbxEnabled')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWriteEpubMaxFileSizeMb')).toEqual([[15]])
    expect(wrapper.emitted('update:fileWritePdfMaxFileSizeMb')).toEqual([[25]])
    expect(wrapper.emitted('update:fileWriteCbxMaxFileSizeMb')).toEqual([[35]])
  })
})
