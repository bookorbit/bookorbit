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
    expect(rows[0]!.text()).toContain('Read-aloud EPUB')
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

    await wrapper.find('button[aria-label="Move Read-aloud EPUB down"]').trigger('click')

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

  describe('applying rules to existing books', () => {
    const rules = { rules: [{ pattern: '(?<series>[^/]+)/', flags: 'u' }] }
    const job = {
      id: 'j',
      libraryId: 1,
      status: 'running' as const,
      total: 4,
      processed: 1,
      updated: 1,
      unchanged: 0,
      skipped: 0,
      failed: 0,
      failureSamples: [],
    }

    function mountReapply(props: Record<string, unknown>) {
      return mount(LibraryCreatorMetadata, {
        props: { metadataPrecedence: ['embedded', 'opfFile', 'regex'], formatPriority: ['cbz'], canReapplyRules: true, ...props },
      })
    }
    const actionButton = (wrapper: ReturnType<typeof mountReapply>) =>
      wrapper.findAll('button').find((button) => button.text().includes('Apply rules to existing books'))

    it('is not offered before the library exists or without rules', () => {
      expect(actionButton(mountReapply({ canReapplyRules: false, regexMetadata: rules, storedRegexMetadata: rules }))).toBeUndefined()
      expect(actionButton(mountReapply({ regexMetadata: null, storedRegexMetadata: null }))).toBeUndefined()
    })

    it('asks for unsaved rules to be saved first', () => {
      const wrapper = mountReapply({ regexMetadata: rules, storedRegexMetadata: null })

      expect(actionButton(wrapper)!.attributes('disabled')).toBeDefined()
      expect(wrapper.text()).toContain('Save your changes first')
    })

    it('confirms before applying the saved rules', async () => {
      const wrapper = mountReapply({ regexMetadata: rules, storedRegexMetadata: rules })

      await actionButton(wrapper)!.trigger('click')
      expect(wrapper.emitted('reapply')).toBeUndefined()
      expect(wrapper.text()).toContain('Only fields the rules decide are written')

      await wrapper.findAll('[role="group"] button')[0]!.trigger('click')
      expect(wrapper.emitted('reapply')).toEqual([[]])
    })

    it('reports progress while the rules are applied, announcing only the outcome', () => {
      const wrapper = mountReapply({ regexMetadata: rules, storedRegexMetadata: rules, reapplyingRules: true, reapplyJob: job })

      expect(wrapper.text()).toContain('Processed 1 of 4: 1 updated')
      expect(wrapper.get('[role="status"]').text()).not.toContain('Processed')
      expect(actionButton(wrapper)).toBeUndefined()
    })

    it('announces the final counts once the rules are applied', () => {
      const done = { ...job, status: 'completed' as const, processed: 4, updated: 3, unchanged: 1 }
      const wrapper = mountReapply({ regexMetadata: rules, storedRegexMetadata: rules, reapplyJob: done })

      expect(wrapper.get('[role="status"]').text()).toContain('Rules applied to existing books.')
      expect(wrapper.get('[role="status"]').text()).toContain('Processed 4 of 4: 3 updated, 1 unchanged')
    })
  })
})
