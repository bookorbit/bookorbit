import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { BookDuplicateCandidate, BookDuplicateGroup } from '@bookorbit/types'

import DuplicateLedgerRow from '../DuplicateLedgerRow.vue'

function candidate(overrides: Partial<BookDuplicateCandidate> & { id: number }): BookDuplicateCandidate {
  return {
    title: 'Frankenstein',
    subtitle: null,
    authors: ['Mary Wollstonecraft Shelley'],
    libraryId: 1,
    libraryName: 'Novels',
    folderPath: `Mary Wollstonecraft Shelley/Frankenstein (${overrides.id})/Frankenstein.epub`,
    status: 'present',
    files: [
      {
        id: overrides.id,
        format: 'epub',
        sizeBytes: 320_612,
        path: `Mary Wollstonecraft Shelley/Frankenstein (${overrides.id})/Frankenstein.epub`,
      },
    ],
    isbn10: null,
    isbn13: null,
    metadataScore: 80,
    readStatus: null,
    readingProgress: null,
    collections: [],
    addedAt: '2026-08-24T07:55:31.000Z',
    updatedAt: null,
    hasCover: false,
    ...overrides,
  }
}

function mountRow(books: BookDuplicateCandidate[], keeperId: number, overrides: Record<string, unknown> = {}) {
  const group: BookDuplicateGroup = {
    id: 7,
    reasons: ['fuzzy_metadata', 'exact_metadata'],
    maxTitleSimilarity: 0.83,
    reclaimableBytes: 0,
    books,
    pairs: [],
  }
  return mount(DuplicateLedgerRow, {
    props: { group, keeperId, keepRule: 'metadata', selected: false, expanded: false, focused: false, ...overrides },
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' }, BookCoverImage: true, DuplicateCompareBench: true } },
  })
}

describe('DuplicateLedgerRow', () => {
  it('leads with the strongest reason rather than every reason the group carries', () => {
    const wrapper = mountRow([candidate({ id: 1 }), candidate({ id: 2, metadataScore: 70 })], 1)

    expect(wrapper.text()).toContain('Exact match')
    expect(wrapper.text()).not.toContain('Similar 83%')
  })

  it('states why the rule kept this copy', () => {
    const wrapper = mountRow([candidate({ id: 1, metadataScore: 88 }), candidate({ id: 2, metadataScore: 70 })], 1)

    expect(wrapper.text()).toContain('metadata 88')
  })

  it('warns when the surviving choice deletes a copy that is being read', () => {
    const reading = candidate({ id: 2, metadataScore: 70, readingProgress: 0.19 })
    const wrapper = mountRow([candidate({ id: 1, metadataScore: 88 }), reading], 1)

    expect(wrapper.text()).toContain('deletes a copy you are 19% through')
  })

  it('says the keeper is a manual override once the rule is overruled', () => {
    const wrapper = mountRow([candidate({ id: 1, metadataScore: 88 }), candidate({ id: 2, metadataScore: 70 })], 2)

    expect(wrapper.text()).toContain('Your choice')
  })

  it('reports the bytes the row would free, not the size of the whole group', () => {
    const keeper = candidate({ id: 1, files: [{ id: 1, format: 'epub', sizeBytes: 500_000, path: 'a/one.epub' }] })
    const discard = candidate({ id: 2, files: [{ id: 2, format: 'epub', sizeBytes: 250_000, path: 'b/two.epub' }] })
    const wrapper = mountRow([keeper, discard], 1)

    expect(wrapper.text()).toContain('244.1 kB')
  })

  it('emits the group id when selected and when expanded', async () => {
    const wrapper = mountRow([candidate({ id: 1 }), candidate({ id: 2 })], 1)

    await wrapper.find('input[type="checkbox"]').setValue(true)
    await wrapper.find('button[aria-expanded]').trigger('click')

    expect(wrapper.emitted('select')?.[0]).toEqual([7])
    expect(wrapper.emitted('expand')?.[0]).toEqual([7])
  })
})
