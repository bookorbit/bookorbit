import { createI18n } from 'vue-i18n'
import { shallowMount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { BookDockFile } from '@bookorbit/types'
import BookDockFileRow from '../BookDockFileRow.vue'
import en from '@/locales/en.json'

function file(status: BookDockFile['status']): BookDockFile {
  return {
    id: 42,
    fileName: 'book.epub',
    fileSize: 1024,
    format: 'epub',
    status,
    embeddedMetadata: { title: 'Book' },
    selectedMetadata: null,
    fetchedMetadata: null,
    targetLibraryId: null,
    targetFolderId: null,
    confidence: null,
    fetchedMetadataSources: null,
    errorMessage: null,
    metadataEditedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function mountRow(status: BookDockFile['status']) {
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
  return shallowMount(BookDockFileRow, {
    props: {
      file: file(status),
      selected: false,
      expanded: false,
      focused: false,
      libraryName: null,
      targetLabel: 'Unassigned',
    },
    global: { plugins: [i18n] },
  })
}

describe('BookDockFileRow metadata refetch action', () => {
  it.each(['ready', 'error'] as const)('emits retry for a %s file', async (status) => {
    const wrapper = mountRow(status)

    await wrapper.get('[data-testid="book-dock-row-retry"]').trigger('click')

    expect(wrapper.emitted('retry')).toEqual([[expect.objectContaining({ id: 42, status })]])
  })

  it.each(['pending', 'extracting', 'fetching'] as const)('disables refetch while a file is %s', (status) => {
    const wrapper = mountRow(status)

    expect(wrapper.get('[data-testid="book-dock-row-retry"]').attributes('disabled')).toBeDefined()
  })

  it('requests confirmation instead of deleting from the row', async () => {
    const wrapper = mountRow('ready')

    await wrapper.get('[data-testid="book-dock-row-discard"]').trigger('click')

    expect(wrapper.emitted('discard')).toEqual([[expect.objectContaining({ id: 42 })]])
  })
})
