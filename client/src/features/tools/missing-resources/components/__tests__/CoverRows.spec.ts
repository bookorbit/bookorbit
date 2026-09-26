import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { BrokenCoverEntry, OrphanedCoverDirEntry } from '@bookorbit/types'
import BrokenCoverRow from '../BrokenCoverRow.vue'
import OrphanedCoverRow from '../OrphanedCoverRow.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key) }),
}))

vi.mock('@/i18n/formatters', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/formatters')>()),
  formatList: (items: string[]) => items.join(', '),
}))

function brokenEntry(overrides: Partial<BrokenCoverEntry> = {}): BrokenCoverEntry {
  return { id: 5, title: 'Dune', authors: ['Frank Herbert'], libraryId: 1, libraryName: 'Main', coverSource: 'custom', slots: [], ...overrides }
}

function orphanEntry(overrides: Partial<OrphanedCoverDirEntry> = {}): OrphanedCoverDirEntry {
  return { bookId: 42, fileCount: 2, sizeBytes: 10, media: [], ...overrides }
}

describe('BrokenCoverRow', () => {
  it('names each broken slot with its source', () => {
    const wrapper = mount(BrokenCoverRow, {
      props: {
        entry: brokenEntry({
          slots: [
            { medium: 'ebook', source: 'extracted' },
            { medium: 'audio', source: 'custom' },
          ],
        }),
        selected: false,
        disabled: false,
      },
    })

    expect(wrapper.findAll('ul li').map((badge) => badge.text())).toEqual([
      'tools.missingResources.brokenSlot.ebookExtracted',
      'tools.missingResources.brokenSlot.audioCustom',
    ])
  })

  it('keeps the plain cover source for a cover that has no slot yet', () => {
    const wrapper = mount(BrokenCoverRow, { props: { entry: brokenEntry(), selected: false, disabled: false } })

    expect(wrapper.findAll('ul li').map((badge) => badge.text())).toEqual(['tools.missingResources.coverSource.custom'])
  })
})

describe('OrphanedCoverRow', () => {
  it.each([
    [['ebook', 'audio'], 'tools.missingResources.table.orphanMedia.both'],
    [['audio'], 'tools.missingResources.table.orphanMedia.audio'],
    [['ebook'], 'tools.missingResources.table.orphanMedia.ebook'],
  ] as const)('names the slot folders %j it holds', (media, label) => {
    const wrapper = mount(OrphanedCoverRow, { props: { entry: orphanEntry({ media: [...media] }), selected: false, disabled: false } })

    expect(wrapper.text()).toContain(label)
  })

  it('names no slot for a folder from before covers had slots', () => {
    const wrapper = mount(OrphanedCoverRow, { props: { entry: orphanEntry(), selected: false, disabled: false } })

    expect(wrapper.text()).not.toContain('orphanMedia')
  })
})
