import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import LibraryCreatorFolders from '../LibraryCreatorFolders.vue'

describe('LibraryCreatorFolders', () => {
  it('adds manual paths without a separate test request', async () => {
    const wrapper = mountFolders()

    await buttonByText(wrapper, 'Enter a path manually').trigger('click')
    await wrapper.get('#manual-folder-path').setValue('/books/fiction')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('update:folders')).toEqual([[['/books/fiction']]])
    expect(wrapper.text()).not.toContain('Test path')
  })

  it('presents validation results beside each selected folder', () => {
    const wrapper = mountFolders({
      folders: ['/books'],
      prescanResult: {
        totalFiles: 1250,
        paths: [{ path: '/books', accessible: true, fileCount: 1250 }],
      },
    })

    expect(wrapper.text()).toContain('Accessible')
    expect(wrapper.text()).toContain('Accessible · 1,250 files')
    expect(wrapper.text()).toContain('1,250 matching files across 1 folder.')
  })
})

function mountFolders(
  props: {
    folders?: string[]
    prescanResult?: { totalFiles: number; paths: { path: string; accessible: boolean; fileCount: number }[] } | null
  } = {},
) {
  return mount(LibraryCreatorFolders, {
    props: {
      folders: props.folders ?? [],
      prescanResult: props.prescanResult ?? null,
      prescanLoading: false,
    },
    global: {
      stubs: {
        FolderPickerModal: true,
      },
    },
  })
}

function buttonByText(wrapper: ReturnType<typeof mountFolders>, text: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().includes(text))
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}
