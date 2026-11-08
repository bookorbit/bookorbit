import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { BookDuplicateAction, BookDuplicateCandidate, BookDuplicateGroup } from '@bookorbit/types'

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
    bookPerFile: false,
    ...overrides,
  }
}

/** As the scan counts it: every copy but the largest. */
function scanReclaimable(books: BookDuplicateCandidate[]): number {
  const sizes = books.map((book) => book.files.reduce((bytes, file) => bytes + (file.sizeBytes ?? 0), 0))
  return sizes.reduce((total, size) => total + size, 0) - Math.max(...sizes)
}

function mountRow(books: BookDuplicateCandidate[], keeperId: number, overrides: Record<string, unknown> = {}) {
  const group: BookDuplicateGroup = {
    id: 7,
    kind: 'duplicate',
    reasons: ['fuzzy_metadata', 'exact_metadata'],
    maxTitleSimilarity: 0.83,
    reclaimableBytes: scanReclaimable(books),
    books,
    pairs: [],
  }
  return mount(DuplicateLedgerRow, {
    props: {
      group,
      keeperId,
      keepRule: 'metadata',
      selected: false,
      expanded: false,
      focused: false,
      action: 'delete',
      actions: ['delete', 'merge', 'link'],
      mergeUnavailableReason: null,
      ...overrides,
    },
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
    const reading = candidate({ id: 2, metadataScore: 70, readingProgress: 19 })
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

  it("shows the scan's reclaimable space whatever the action, and drops the deletion warning when the group merges", () => {
    const books = [candidate({ id: 1, metadataScore: 88 }), candidate({ id: 2, metadataScore: 70, readingProgress: 19 })]
    const wrapper = mountRow(books, 1, { action: 'merge' })

    expect(wrapper.text()).toContain('Merge into keeper')
    expect(wrapper.text()).not.toContain('deletes a copy you are 19% through')
    expect(wrapper.get('[data-testid="duplicate-row-reclaimable"]').text()).toBe('313.1 kB')
  })

  it('reclaims nothing for a pair in another format, which is never deleted', () => {
    const books = [candidate({ id: 1 }), candidate({ id: 2 })]
    const pair: BookDuplicateGroup = {
      id: 7,
      kind: 'other_format',
      reasons: ['title_author'],
      maxTitleSimilarity: 1,
      reclaimableBytes: 320_612,
      books,
      pairs: [],
    }
    const wrapper = mountRow(books, 1, { action: null, actions: ['link'], group: pair })
    expect(wrapper.get('[data-testid="duplicate-row-reclaimable"]').text()).toBe('None')
  })

  it('says why merge is not offered and that the books can be linked instead (H3, H4)', () => {
    const wrapper = mountRow([candidate({ id: 1 }), candidate({ id: 2, libraryId: 2 })], 1, {
      expanded: true,
      action: null,
      actions: ['delete', 'link'],
      mergeUnavailableReason: 'DIFFERENT_LIBRARIES',
    })

    const note = wrapper.find('[data-testid="duplicate-merge-unavailable"]')
    expect(note.text()).toContain('the books are in different libraries')
    expect(note.text()).toContain('Link keeps them as separate books')
  })

  it('names the library a merge across libraries puts the book in, and says nothing of it within one library', () => {
    const books = [candidate({ id: 1 }), candidate({ id: 2, libraryId: 2, libraryName: 'Classics' })]
    const across = mountRow(books, 2, { expanded: true, action: 'merge' })

    expect(across.text()).toContain('Into Classics')
    expect(across.get('[data-testid="duplicate-cross-library-merge"]').text()).toContain('expected to live in Classics')

    const within = mountRow([candidate({ id: 1 }), candidate({ id: 2 })], 1, { expanded: true, action: 'merge' })
    expect(within.find('[data-testid="duplicate-cross-library-merge"]').exists()).toBe(false)
    expect(within.text()).not.toContain('Into Novels')

    const linking = mountRow(books, 2, { expanded: true, action: 'link' })
    expect(linking.find('[data-testid="duplicate-cross-library-merge"]').exists()).toBe(false)
  })

  it('offers only the actions the user may take (H11)', () => {
    const wrapper = mountRow([candidate({ id: 1 }), candidate({ id: 2 })], 1, {
      expanded: true,
      action: 'merge',
      actions: ['merge', 'link'] satisfies BookDuplicateAction[],
    })

    const options = wrapper.findAll('select option').map((option) => option.attributes('value'))
    expect(options).toEqual(['', 'merge', 'link'])
  })

  it('hides the action picker and disables review when the user may take no action', () => {
    const wrapper = mountRow([candidate({ id: 1 }), candidate({ id: 2 })], 1, { expanded: true, action: null, actions: [] })

    expect(wrapper.find('select').exists()).toBe(false)
    const review = wrapper.findAll('button').find((button) => button.text() === 'Choose an action')
    expect(review?.attributes('disabled')).toBeDefined()
  })

  it('emits the picked action and a review request for the group', async () => {
    const wrapper = mountRow([candidate({ id: 1 }), candidate({ id: 2 })], 1, { expanded: true, action: 'merge' })

    await wrapper.find('select').setValue('link')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Review merge')
      ?.trigger('click')

    expect(wrapper.emitted('action')?.[0]).toEqual([7, 'link'])
    expect(wrapper.emitted('review')?.[0]).toEqual([7])
  })
})

describe('DuplicateLedgerRow space', () => {
  it('shows the figure the scan total adds up, even when the chosen keeper is not the largest copy', () => {
    const small = candidate({ id: 1, files: [{ id: 1, format: 'epub', sizeBytes: 250_000, path: 'a/one.epub' }] })
    const large = candidate({ id: 2, files: [{ id: 2, format: 'epub', sizeBytes: 500_000, path: 'b/two.epub' }] })
    const wrapper = mountRow([small, large], 1, { action: 'delete' })

    expect(wrapper.get('[data-testid="duplicate-row-reclaimable"]').text()).toBe('244.1 kB')
  })
})
