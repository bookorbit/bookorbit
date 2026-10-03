import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { READ_ALONG_FORMAT_PRIORITY } from '@bookorbit/types'

import { i18n } from '@/i18n'
import LibraryCreatorMetadata from '../LibraryCreatorMetadata.vue'

function mountMetadata(props: {
  formatPriority: string[]
  formatCounts?: Record<string, number> | null
  metadataPrecedence?: string[]
  allowedFormats?: string[]
}) {
  return mount(LibraryCreatorMetadata, {
    props: { metadataPrecedence: ['embedded', 'opfFile'], ...props },
  })
}

function rowCodes(wrapper: ReturnType<typeof mountMetadata>): string[] {
  return wrapper.findAll('ol[aria-labelledby="primary-file-title"] > li').map((row) => row.findAll('span')[2]!.text())
}

describe('LibraryCreatorMetadata', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'en'
  })

  it('shows the read-along entry as an EPUB row marked with headphones', () => {
    const wrapper = mountMetadata({ formatPriority: [READ_ALONG_FORMAT_PRIORITY, 'm4b', 'epub'] })
    const rows = wrapper.findAll('ol[aria-labelledby="primary-file-title"] > li')

    expect(rowCodes(wrapper)).toEqual(['EPUB', 'M4B', 'EPUB'])
    expect(rows[0]!.find('svg.lucide-headphones-icon, svg[class*="headphones"]').exists()).toBe(true)
    expect(rows[0]!.text()).toContain('Read-along EPUB')
    expect(rows[2]!.text()).toContain('EPUB e-book')
  })

  it('ranks only the formats the library holds, with their counts', () => {
    const wrapper = mountMetadata({
      formatPriority: ['epub', 'kepub', 'pdf', 'cbz', 'mobi', 'azw3', 'fb2', 'm4b'],
      formatCounts: { epub: 378, azw3: 35, mobi: 24, fb2: 12, pdf: 6 },
    })

    expect(rowCodes(wrapper)).toEqual(['EPUB', 'PDF', 'MOBI', 'AZW3', 'FB2'])
    expect(wrapper.text()).toContain('378')
    expect(wrapper.text()).toContain('3 formats this library does not hold keep their default order after these.')
  })

  it('reveals the rest of the order on request', async () => {
    const wrapper = mountMetadata({ formatPriority: ['epub', 'kepub', 'pdf', 'cbz'], formatCounts: { epub: 3 } })

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Show all 4')!
      .trigger('click')

    expect(rowCodes(wrapper)).toEqual(['EPUB', 'KEPUB', 'PDF', 'CBZ'])
  })

  it('moves among the visible rows even when hidden formats sit between them', async () => {
    const wrapper = mountMetadata({ formatPriority: ['epub', 'kepub', 'pdf', 'mobi'], formatCounts: { epub: 3, mobi: 2 } })

    await wrapper.find('button[aria-label="Move MOBI e-book up"]').trigger('click')

    expect(wrapper.emitted('update:formatPriority')).toEqual([[['mobi', 'epub', 'kepub', 'pdf']]])
  })

  it('moves the read-along entry like any other format', async () => {
    const wrapper = mountMetadata({ formatPriority: [READ_ALONG_FORMAT_PRIORITY, 'm4b', 'epub'] })

    await wrapper.find('button[aria-label="Move Read-along EPUB down"]').trigger('click')

    expect(wrapper.emitted('update:formatPriority')).toEqual([[['m4b', READ_ALONG_FORMAT_PRIORITY, 'epub']]])
  })

  it('marks formats that are not imported', () => {
    const wrapper = mountMetadata({ formatPriority: ['epub', 'pdf'], allowedFormats: ['epub'] })

    expect(wrapper.findAll('ol[aria-labelledby="primary-file-title"] > li')[1]!.text()).toContain('Not imported')
  })

  it('moves a source earlier in the precedence list', async () => {
    const wrapper = mountMetadata({ formatPriority: ['epub'] })

    await wrapper.get('button[aria-label="Move metadata.opf file up"]').trigger('click')

    expect(wrapper.emitted('update:metadataPrecedence')).toEqual([[['opfFile', 'embedded', 'regex']]])
  })

  it('fills in a source missing from an older saved list before reordering', async () => {
    const wrapper = mountMetadata({ formatPriority: ['epub'], metadataPrecedence: ['embedded'] })

    expect(wrapper.text()).toContain('metadata.opf file')
    await wrapper.get('button[aria-label="Move metadata.opf file up"]').trigger('click')

    expect(wrapper.emitted('update:metadataPrecedence')).toEqual([[['opfFile', 'embedded', 'regex']]])
  })
})
