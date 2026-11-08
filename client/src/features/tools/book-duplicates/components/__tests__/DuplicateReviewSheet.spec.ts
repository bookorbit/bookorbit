import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import {
  BOOK_DUPLICATE_RESOLUTION_MAX_GROUPS,
  type BookDuplicateAction,
  type BookDuplicateBookAction,
  type BookDuplicateCandidate,
  type BookDuplicateGroup,
  type BookDuplicateResolutionJob,
} from '@bookorbit/types'

import DuplicateReviewSheet from '../DuplicateReviewSheet.vue'

const stubs = {
  Sheet: { template: '<div><slot /></div>' },
  SheetContent: { template: '<div><slot /></div>' },
  SheetHeader: { template: '<div><slot /></div>' },
  SheetTitle: { template: '<h2><slot /></h2>' },
  SheetDescription: { template: '<p><slot /></p>' },
  DuplicateMergeReview: { template: '<div data-testid="merge-review-stub" />' },
}

function book(id: number, overrides: Partial<BookDuplicateCandidate> = {}): BookDuplicateCandidate {
  return {
    id,
    title: 'Dracula',
    subtitle: null,
    authors: ['Bram Stoker'],
    libraryId: 1,
    libraryName: 'Novels',
    folderPath: `Bram Stoker/Dracula (${id})`,
    status: 'present',
    files: [{ id, format: 'epub', sizeBytes: 2048, path: `Bram Stoker/Dracula (${id})/Dracula.epub` }],
    isbn10: null,
    isbn13: null,
    metadataScore: 80,
    readStatus: null,
    readingProgress: null,
    collections: [],
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    hasCover: false,
    bookPerFile: false,
    ...overrides,
  }
}

function group(id: number, books: BookDuplicateCandidate[]): BookDuplicateGroup {
  return { id, kind: 'duplicate', reasons: ['file_hash'], maxTitleSimilarity: 1, reclaimableBytes: 0, books, pairs: [] }
}

interface MountOptions {
  groups: BookDuplicateGroup[]
  actions: Record<number, BookDuplicateAction | null>
  bookActions?: Record<number, BookDuplicateBookAction>
  allGroups?: boolean
  totalGroups?: number
  canDelete?: boolean
  job?: BookDuplicateResolutionJob | null
}

function mountSheet(options: MountOptions) {
  return mount(DuplicateReviewSheet, {
    props: {
      open: true,
      groups: options.groups,
      allGroups: options.allGroups ?? false,
      totalGroups: options.totalGroups ?? options.groups.length,
      keeperFor: (target: BookDuplicateGroup) => target.books[0]!.id,
      actionFor: (target: BookDuplicateGroup) => options.actions[target.id] ?? null,
      actionsFor: () => (options.canDelete === false ? ['merge', 'link'] : ['delete', 'merge', 'link']),
      bookActionFor: (target: BookDuplicateGroup, bookId: number) => options.bookActions?.[bookId] ?? options.actions[target.id] ?? null,
      canDelete: options.canDelete ?? true,
      job: options.job ?? null,
      running: false,
      error: null,
    },
    global: { stubs },
  })
}

describe('DuplicateReviewSheet', () => {
  it('opens the full merge review for a single group set to merge', () => {
    const wrapper = mountSheet({ groups: [group(1, [book(1), book(2)])], actions: { 1: 'merge' } })

    expect(wrapper.find('[data-testid="merge-review-stub"]').exists()).toBe(true)
    expect(wrapper.get('h2').text()).toBe('Merge into keeper')
  })

  it('lets each copy take its own action and reports the change (H5)', async () => {
    const wrapper = mountSheet({
      groups: [group(1, [book(1), book(2), book(3)]), group(2, [book(4), book(5)])],
      actions: { 1: 'merge', 2: 'delete' },
    })

    const selects = wrapper.findAll('select')
    expect(selects).toHaveLength(3)
    expect(selects[0]!.findAll('option').map((option) => option.attributes('value'))).toEqual(['delete', 'merge', 'link', 'skip'])

    await selects[1]!.setValue('skip')

    expect(wrapper.emitted('book-action')?.[0]).toEqual([1, 3, 'skip'])
  })

  it('leaves the identical-copy cleanup off until the user turns it on', async () => {
    const wrapper = mountSheet({ groups: [group(1, [book(1), book(2)]), group(2, [book(3), book(4)])], actions: { 1: 'merge', 2: 'merge' } })
    const confirm = () => wrapper.findAll('button').find((button) => button.text().startsWith('Resolve'))!

    await confirm().trigger('click')
    await wrapper.find('input[type="checkbox"]').setValue(true)
    await confirm().trigger('click')

    expect(wrapper.emitted('confirm')).toEqual([[{ removeIdenticalCopies: false }], [{ removeIdenticalCopies: true }]])
  })

  it('does not offer the identical-copy cleanup without the delete permission', () => {
    const wrapper = mountSheet({
      groups: [group(1, [book(1), book(2)]), group(2, [book(3), book(4)])],
      actions: { 1: 'merge', 2: 'merge' },
      canDelete: false,
    })

    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
  })

  it('lists the merges that move files between libraries apart from the rest, with the library each goes into', () => {
    const wrapper = mountSheet({
      groups: [
        group(1, [book(1, { libraryId: 2, libraryName: 'Classics', title: 'Carmilla' }), book(2)]),
        group(2, [book(3), book(4)]),
        group(3, [book(5, { libraryId: 2, libraryName: 'Classics' }), book(6)]),
      ],
      actions: { 1: 'merge', 2: 'merge', 3: 'link' },
    })

    const section = wrapper.get('[data-testid="duplicate-cross-library-merges"]')
    expect(section.get('h3').text()).toBe('1 merge moves files between libraries')
    const items = section.findAll('li').map((item) => item.text())
    expect(items).toEqual([expect.stringContaining('Carmilla')])
    expect(items[0]).toContain('Into Classics')
  })

  it('leaves the cross-library list out when every merge stays in one library', () => {
    const wrapper = mountSheet({ groups: [group(1, [book(1), book(2)]), group(2, [book(3), book(4)])], actions: { 1: 'merge', 2: 'merge' } })

    expect(wrapper.find('[data-testid="duplicate-cross-library-merges"]').exists()).toBe(false)
  })

  it('counts every matching group when the selection spans all pages (H8)', () => {
    const wrapper = mountSheet({ groups: [group(1, [book(1), book(2)])], actions: { 1: 'merge' }, allGroups: true, totalGroups: 42 })

    expect(wrapper.find('[data-testid="merge-review-stub"]').exists()).toBe(false)
    expect(wrapper.get('h2').text()).toBe('Resolve 42 groups')
    expect(wrapper.text()).toContain('Plus 41 more groups on other pages')
    expect(wrapper.find('[data-testid="duplicate-review-capped"]').exists()).toBe(false)
  })

  it('says one run stops at the resolution cap and leaves groups without a default action alone', () => {
    const wrapper = mountSheet({
      groups: [group(1, [book(1), book(2)])],
      actions: { 1: 'merge' },
      allGroups: true,
      totalGroups: BOOK_DUPLICATE_RESOLUTION_MAX_GROUPS + 250,
    })

    expect(wrapper.get('h2').text()).toBe('Resolve 1,000 groups')
    expect(wrapper.text()).toContain('Plus 999 more groups on other pages')
    expect(wrapper.text()).toContain('left as it is')
    expect(wrapper.get('[data-testid="duplicate-review-capped"]').text()).toContain('1,000')
  })

  it('shows each group and copy outcome once the run reports them', () => {
    const job: BookDuplicateResolutionJob = {
      id: 5,
      scanId: 11,
      status: 'completed',
      processed: 2,
      total: 2,
      currentGroupId: null,
      outcomes: [
        { groupId: 1, keeperId: 1, status: 'done', reason: null, books: [{ bookId: 2, action: 'merge', status: 'merged', reason: null }] },
        { groupId: 3, keeperId: 3, status: 'skipped', reason: 'STALE', books: [{ bookId: 4, action: 'delete', status: 'skipped', reason: 'STALE' }] },
      ],
      errorCode: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:05.000Z',
    }
    const wrapper = mountSheet({ groups: [group(1, [book(1), book(2)]), group(3, [book(3), book(4)])], actions: { 1: 'merge', 3: 'delete' }, job })

    const outcomes = wrapper.findAll('[data-testid="duplicate-group-outcome"]').map((outcome) => outcome.text())
    expect(outcomes).toEqual(['Done', 'Skipped: changed since the scan'])
    expect(wrapper.text()).toContain('Merged')
    expect(wrapper.text()).toContain('Finished: 2 of 2 groups')
    expect(wrapper.find('select').exists()).toBe(false)
  })
})
