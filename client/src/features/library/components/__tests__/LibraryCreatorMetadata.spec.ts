import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { READ_ALONG_FORMAT_PRIORITY } from '@bookorbit/types'

import { i18n } from '@/i18n'
import LibraryCreatorMetadata from '../LibraryCreatorMetadata.vue'

function mountMetadata(formatPriority: string[]) {
  return mount(LibraryCreatorMetadata, {
    props: { metadataPrecedence: ['embedded'], formatPriority },
  })
}

describe('LibraryCreatorMetadata', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'en'
  })

  it('shows the read-along entry as an EPUB row marked with headphones', () => {
    const wrapper = mountMetadata([READ_ALONG_FORMAT_PRIORITY, 'm4b', 'epub'])
    const formatRows = wrapper.findAll('[draggable="true"]').slice(1)

    expect(formatRows.map((row) => row.find('.font-mono').text())).toEqual(['EPUB', 'M4B', 'EPUB'])
    expect(formatRows[0]!.find('.font-mono svg').exists()).toBe(true)
    expect(formatRows[2]!.find('.font-mono svg').exists()).toBe(false)
    expect(formatRows[0]!.text()).toContain('Read-along EPUB')
    expect(formatRows[2]!.text()).toContain('EPUB e-book')
  })

  it('labels move controls with the translated format name', () => {
    const wrapper = mountMetadata([READ_ALONG_FORMAT_PRIORITY, 'm4b', 'epub'])

    expect(wrapper.find('button[aria-label="Move Read-along EPUB down"]').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="Move M4B audiobook up"]').exists()).toBe(true)
  })

  it('moves the read-along entry like any other format', async () => {
    const wrapper = mountMetadata([READ_ALONG_FORMAT_PRIORITY, 'm4b', 'epub'])

    await wrapper.find('button[aria-label="Move Read-along EPUB down"]').trigger('click')

    expect(wrapper.emitted('update:formatPriority')).toEqual([[['m4b', READ_ALONG_FORMAT_PRIORITY, 'epub']]])
  })
})
