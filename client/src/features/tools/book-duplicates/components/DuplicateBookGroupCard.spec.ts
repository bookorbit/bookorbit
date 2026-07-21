import { mount } from '@vue/test-utils'
import type { BookDuplicateCandidate, BookDuplicateGroup } from '@bookorbit/types'
import { describe, expect, it } from 'vitest'

import DuplicateBookGroupCard from './DuplicateBookGroupCard.vue'

function makeBook(id: number): BookDuplicateCandidate {
  return {
    id,
    title: `Book ${id}`,
    subtitle: null,
    authors: ['Author'],
    libraryId: 1,
    libraryName: 'Main',
    folderPath: `author/book-${id}`,
    status: 'present',
    files: [{ id: id * 10, format: 'epub', sizeBytes: 1024, path: `book-${id}.epub` }],
    isbn10: null,
    isbn13: '9780306406157',
    metadataScore: 80,
    readStatus: null,
    readingProgress: null,
    collections: [],
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    hasCover: false,
  }
}

const group: BookDuplicateGroup = {
  id: 5,
  reasons: ['isbn', 'fuzzy_metadata'],
  maxTitleSimilarity: 0.91,
  books: [makeBook(1), makeBook(2)],
  pairs: [{ bookIdA: 1, bookIdB: 2, reasons: ['isbn', 'fuzzy_metadata'], titleSimilarity: 0.91 }],
}

describe('DuplicateBookGroupCard', () => {
  it('shows the primary file path and size without expanding details', () => {
    const wrapper = mount(DuplicateBookGroupCard, {
      props: { group },
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })

    expect(wrapper.text()).toContain('book-1.epub')
    expect(wrapper.text()).toContain('1 KB')
  })

  it('shows pair details once instead of repeating them for every candidate', async () => {
    const wrapper = mount(DuplicateBookGroupCard, {
      props: { group },
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Show details'))!
      .trigger('click')

    expect(wrapper.text().match(/Match details/g)).toHaveLength(1)
  })

  it('requires an explicit keeper and explicit discard selection before resolving', async () => {
    const wrapper = mount(DuplicateBookGroupCard, {
      props: { group },
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const radios = wrapper.findAll('input[type="radio"]')
    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    const resolveButton = wrapper.findAll('button').find((button) => button.text().includes('Delete'))!

    expect(resolveButton.attributes('disabled')).toBeDefined()
    await radios[0]!.setValue(true)
    expect(checkboxes[0]!.attributes('disabled')).toBeDefined()
    expect(resolveButton.attributes('disabled')).toBeDefined()

    await checkboxes[1]!.setValue(true)
    expect(resolveButton.attributes('disabled')).toBeUndefined()
    await resolveButton.trigger('click')

    expect(wrapper.emitted('resolve')?.[0]).toEqual([5, [2]])
  })

  it('emits a session-only dismissal without deleting anything', async () => {
    const wrapper = mount(DuplicateBookGroupCard, {
      props: { group },
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const dismissButton = wrapper.findAll('button').find((button) => button.text().includes('Not duplicates'))!

    await dismissButton.trigger('click')

    expect(wrapper.emitted('dismiss')?.[0]).toEqual([5])
    expect(wrapper.emitted('resolve')).toBeUndefined()
  })

  it('does not allow a transitive cluster member to be discarded without a direct keeper match', async () => {
    const transitiveGroup: BookDuplicateGroup = {
      ...group,
      books: [makeBook(1), makeBook(2), makeBook(3)],
      pairs: [
        { bookIdA: 1, bookIdB: 2, reasons: ['isbn'], titleSimilarity: null },
        { bookIdA: 2, bookIdB: 3, reasons: ['fuzzy_metadata'], titleSimilarity: 0.9 },
      ],
    }
    const wrapper = mount(DuplicateBookGroupCard, {
      props: { group: transitiveGroup },
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const radios = wrapper.findAll('input[type="radio"]')
    const checkboxes = wrapper.findAll('input[type="checkbox"]')

    expect(checkboxes.every((checkbox) => checkbox.attributes('disabled') !== undefined)).toBe(true)
    await radios[0]!.setValue(true)

    expect(checkboxes[1]!.attributes('disabled')).toBeUndefined()
    expect(checkboxes[2]!.attributes('disabled')).toBeDefined()
    expect((checkboxes[2]!.element as HTMLInputElement).checked).toBe(false)
  })

  it('clears discard selections that are incompatible with a newly selected keeper', async () => {
    const bridgedGroup: BookDuplicateGroup = {
      ...group,
      books: [makeBook(1), makeBook(2), makeBook(3)],
      pairs: [
        { bookIdA: 1, bookIdB: 2, reasons: ['file_hash'], titleSimilarity: null },
        { bookIdA: 1, bookIdB: 3, reasons: ['fuzzy_metadata'], titleSimilarity: 0.9 },
      ],
    }
    const wrapper = mount(DuplicateBookGroupCard, {
      props: { group: bridgedGroup },
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const radios = wrapper.findAll('input[type="radio"]')
    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    const resolveButton = wrapper.findAll('button').find((button) => button.text().includes('Delete'))!

    await radios[0]!.setValue(true)
    await checkboxes[2]!.setValue(true)
    expect(resolveButton.attributes('disabled')).toBeUndefined()

    await radios[1]!.setValue(true)

    expect((checkboxes[2]!.element as HTMLInputElement).checked).toBe(false)
    expect(checkboxes[2]!.attributes('disabled')).toBeDefined()
    expect(resolveButton.attributes('disabled')).toBeDefined()
  })
})
