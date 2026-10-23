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
        fileWriteAllFiles: false,
        fileWriteReadAlongEnabled: false,
        fileWriteReadAlongMaxFileSizeMb: 1000,
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
    fileWriteAllFiles: true,
    fileWriteReadAlongEnabled: true,
    fileWriteReadAlongMaxFileSizeMb: 1000,
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
    await checkbox(wrapper, 'Write audio metadata').setValue(false)
    await checkbox(wrapper, 'Write read-along EPUB metadata').setValue(false)

    expect(wrapper.emitted('update:fileWriteEpubEnabled')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWriteFb2Enabled')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWritePdfEnabled')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWriteCbxEnabled')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWriteKindleEnabled')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWriteAudioEnabled')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWriteReadAlongEnabled')).toEqual([[false]])
  })

  it('emits max-size updates for every format', async () => {
    const wrapper = mountComponent(ALL_ENABLED)

    expect(wrapper.findAll('input[type="number"]')).toHaveLength(7)

    await wrapper.find('#epub-max-size').setValue('15')
    await wrapper.find('#fb2-max-size').setValue('65')
    await wrapper.find('#pdf-max-size').setValue('25')
    await wrapper.find('#cbx-max-size').setValue('35')
    await wrapper.find('#kindle-max-size').setValue('55')
    await wrapper.find('#audio-max-size').setValue('45')
    await wrapper.find('#readAlong-max-size').setValue('1500')

    expect(wrapper.emitted('update:fileWriteEpubMaxFileSizeMb')).toEqual([[15]])
    expect(wrapper.emitted('update:fileWriteFb2MaxFileSizeMb')).toEqual([[65]])
    expect(wrapper.emitted('update:fileWritePdfMaxFileSizeMb')).toEqual([[25]])
    expect(wrapper.emitted('update:fileWriteCbxMaxFileSizeMb')).toEqual([[35]])
    expect(wrapper.emitted('update:fileWriteKindleMaxFileSizeMb')).toEqual([[55]])
    expect(wrapper.emitted('update:fileWriteAudioMaxFileSizeMb')).toEqual([[45]])
    expect(wrapper.emitted('update:fileWriteReadAlongMaxFileSizeMb')).toEqual([[1500]])
  })

  it('shows read-along EPUBs as their own row, off by default, without a library count', () => {
    const wrapper = mountComponent({ fileWriteEnabled: true, formatCounts: { epub: 378 } })

    const row = wrapper.findAll('li').find((node) => node.text().includes('Read-along EPUB'))!
    expect(row.text()).toContain('synced narration')
    expect((checkbox(wrapper, 'Write read-along EPUB metadata').element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.get('#readAlong-max-size').attributes('disabled')).toBeDefined()
    expect(row.text()).toContain('–')
  })

  it('keeps a size limit visible but disabled while its format is off', () => {
    const wrapper = mountComponent({ fileWriteEnabled: true, fileWriteFb2Enabled: false })

    expect(wrapper.text()).toContain('FictionBook (FB2)')
    expect(wrapper.get('#fb2-max-size').attributes('disabled')).toBeDefined()
    expect(wrapper.get('#fb2-max-size').attributes('aria-label')).toBe('FictionBook (FB2) size limit in MB')
  })

  it('keeps audio writable without the cover image, since its tags are written either way', () => {
    const wrapper = mountComponent({ fileWriteEnabled: true, fileWriteWriteCover: false, fileWriteAudioEnabled: true })

    const audio = checkbox(wrapper, 'Write audio metadata')
    expect(audio.attributes('disabled')).toBeUndefined()
    expect((audio.element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.get('#audio-max-size').attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).toContain('Writes tags such as title, authors, narrators, and series')
  })

  it('leaves the stored audio preference alone when cover writing is turned off', async () => {
    const wrapper = mountComponent({ fileWriteEnabled: true, fileWriteWriteCover: true, fileWriteAudioEnabled: true })

    await wrapper.findAll('input[type="checkbox"]')[0]!.setValue(false)

    expect(wrapper.emitted('update:fileWriteWriteCover')).toEqual([[false]])
    expect(wrapper.emitted('update:fileWriteAudioEnabled')).toBeUndefined()
  })

  it('offers the all-files scope and says what still limits it', async () => {
    const wrapper = mountComponent({ fileWriteEnabled: true })

    expect(wrapper.text()).toContain('Write into every file of a book')
    expect(wrapper.text()).toContain('Every book format there is written')
    expect(wrapper.text()).toContain('Format toggles and size limits below still apply')
    expect(wrapper.text()).toContain('does not undo files already written')

    const scope = wrapper.findAll('label').find((node) => node.text().includes('Write into every file of a book'))!
    await scope.get('input[type="checkbox"]').setValue(true)

    expect(wrapper.emitted('update:fileWriteAllFiles')).toEqual([[true]])
  })

  it('reflects a stored all-files scope', () => {
    const wrapper = mountComponent({ fileWriteEnabled: true, fileWriteAllFiles: true })

    const scope = wrapper.findAll('label').find((node) => node.text().includes('Write into every file of a book'))!
    expect((scope.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true)
  })

  it('counts the books each writer would touch when counts are known', () => {
    const wrapper = mountComponent({ fileWriteEnabled: true, formatCounts: { mobi: 24, azw3: 35, epub: 378 } })

    const kindle = wrapper.findAll('li').find((row) => row.text().includes('Kindle'))!
    expect(kindle.text()).toContain('59')
  })
})
