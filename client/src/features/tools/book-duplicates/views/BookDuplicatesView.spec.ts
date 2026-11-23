import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import {
  Permission,
  type BookDuplicateCandidate,
  type BookDuplicateDismissal,
  type BookDuplicateGroup,
  type BookDuplicateScan,
} from '@bookorbit/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getActiveBookDuplicateScan, getBookDuplicateDismissals, getBookDuplicateGroups } from '../../api/book-duplicates'
import BookDuplicatesView from './BookDuplicatesView.vue'

const granted = vi.hoisted(() => new Set<string>())

vi.mock('../../api/book-duplicates', () => ({
  createBookDuplicateScan: vi.fn<(...args: unknown[]) => unknown>(),
  dismissBookDuplicateGroup: vi.fn<(...args: unknown[]) => unknown>(),
  getActiveBookDuplicateScan: vi.fn<(...args: unknown[]) => unknown>(),
  getBookDuplicateDismissals: vi.fn<(...args: unknown[]) => unknown>(),
  getBookDuplicateGroups: vi.fn<(...args: unknown[]) => unknown>(),
  getBookDuplicateResolution: vi.fn<(...args: unknown[]) => unknown>(),
  getBookDuplicateScan: vi.fn<(...args: unknown[]) => unknown>(),
  restoreBookDuplicateDismissal: vi.fn<(...args: unknown[]) => unknown>(),
  startBookDuplicateResolution: vi.fn<(...args: unknown[]) => unknown>(),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (name: string) => granted.has(name) }),
}))

vi.mock('@/features/library/composables/useLibraryPermissions', () => ({
  useLibraryPermissions: () => ({ hasLibraryPermission: (name: string) => granted.has(name) }),
}))

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({ libraries: ref([]), fetchLibraries: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) }),
}))

vi.mock('@/features/scanner/composables/useScanProgress', () => ({
  getSocket: () => ({ on: vi.fn<() => void>(), off: vi.fn<() => void>() }),
}))

const scan: BookDuplicateScan = {
  id: 11,
  status: 'completed',
  libraryIds: [2],
  requestedLibraryId: 2,
  similarityPercent: 85,
  processedBooks: 10,
  totalBooks: 10,
  progressPercent: 100,
  totalGroups: 1,
  totalExtraCopies: 1,
  totalReclaimableBytes: 1000,
  totalOtherFormatPairs: 2,
  totalOtherEditionPairs: 3,
  errorCode: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:01:00.000Z',
}

function recording(id: number, narrator: string): BookDuplicateCandidate {
  return {
    id,
    title: 'The Hobbit',
    subtitle: narrator,
    authors: ['J. R. R. Tolkien'],
    libraryId: 2,
    libraryName: 'Audiobooks',
    folderPath: `Tolkien/The Hobbit (${narrator})`,
    status: 'present',
    files: [{ id, format: 'm4b', sizeBytes: 1000 * id, path: `Tolkien/The Hobbit (${narrator})/book.m4b` }],
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
  }
}

const editionGroup: BookDuplicateGroup = {
  id: 40,
  kind: 'other_edition',
  reasons: ['same_work', 'title_author'],
  maxTitleSimilarity: null,
  reclaimableBytes: 0,
  books: [recording(1, 'Rob Inglis'), recording(2, 'Andy Serkis')],
  pairs: [{ bookIdA: 1, bookIdB: 2, reasons: ['same_work', 'title_author'], titleSimilarity: null }],
}

function mountView() {
  return mount(BookDuplicatesView, {
    global: {
      stubs: { DuplicateScanStrip: true, DuplicateReviewSheet: true, BookCoverImage: true, DuplicateCompareBench: true, RouterLink: true },
    },
  })
}

describe('BookDuplicatesView', () => {
  beforeEach(() => {
    granted.clear()
    for (const permission of [Permission.LibraryDeleteBooks, Permission.LibraryMergeBooks, Permission.LibraryEditMetadata]) granted.add(permission)
    vi.mocked(getActiveBookDuplicateScan).mockResolvedValue(scan)
    vi.mocked(getBookDuplicateDismissals).mockResolvedValue([])
    vi.mocked(getBookDuplicateGroups).mockResolvedValue({
      groups: [],
      total: 0,
      page: 1,
      pageSize: 20,
      kindTotals: { duplicate: 0, other_format: 2, other_edition: 3 },
    })
  })

  afterEach(() => {
    vi.mocked(getBookDuplicateGroups).mockReset()
  })

  it('lists Other editions after Same book, other format, with its pair count', async () => {
    const wrapper = mountView()
    await flushPromises()

    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs.map((tab) => tab.attributes('data-testid'))).toEqual([
      'duplicate-kind-duplicate',
      'duplicate-kind-other_format',
      'duplicate-kind-other_edition',
    ])
    expect(tabs[2]!.text()).toContain('Other editions')
    expect(wrapper.get('[data-testid="duplicate-kind-count-other_edition"]').text()).toBe('3')
    expect(wrapper.get('[data-testid="duplicate-kind-count-other_format"]').text()).toBe('2')
    expect(wrapper.find('[data-testid="duplicate-kind-count-duplicate"]').exists()).toBe(false)
  })

  it("counts only the groups still open, not the scan's own totals", async () => {
    const wrapper = mountView()
    await flushPromises()
    vi.mocked(getBookDuplicateGroups).mockResolvedValue({
      groups: [],
      total: 0,
      page: 1,
      pageSize: 20,
      kindTotals: { duplicate: 0, other_format: 0, other_edition: 1 },
    })

    await wrapper.get('[data-testid="duplicate-kind-other_edition"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="duplicate-kind-count-other_edition"]').text()).toBe('1')
    expect(wrapper.find('[data-testid="duplicate-kind-count-other_format"]').exists()).toBe(false)
  })

  it('loads the other editions and offers to link them as editions, never to delete them', async () => {
    const wrapper = mountView()
    await flushPromises()
    vi.mocked(getBookDuplicateGroups).mockResolvedValue({
      groups: [editionGroup],
      total: 1,
      page: 1,
      pageSize: 20,
      kindTotals: { duplicate: 0, other_format: 2, other_edition: 1 },
    })

    await wrapper.get('[data-testid="duplicate-kind-other_edition"]').trigger('click')
    await flushPromises()

    expect(getBookDuplicateGroups).toHaveBeenLastCalledWith(11, expect.objectContaining({ kind: 'other_edition' }))
    expect(wrapper.get('[data-testid="duplicate-kind-other_edition"]').attributes('aria-selected')).toBe('true')
    expect(wrapper.text()).toMatch(/1\s*pair\b/)
    expect(wrapper.text()).not.toContain('extra cop')

    await wrapper.get('[data-group-id="40"] button[aria-expanded]').trigger('click')
    const options = wrapper.findAll('[data-group-id="40"] option').map((option) => option.text())
    expect(options).toContain('Group as editions')
    expect(options).not.toContain('Delete extras')
    expect(wrapper.get('[data-group-id="40"]').text()).toContain('Not editions')
  })

  it('names other-edition dismissals by their kind', async () => {
    const dismissal: BookDuplicateDismissal = {
      kind: 'other_edition',
      bookIdA: 1,
      bookIdB: 2,
      titleA: 'The Hobbit',
      titleB: 'The Hobbit',
      detailA: 'Allen & Unwin · 1937',
      detailB: 'Rob Inglis',
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    vi.mocked(getBookDuplicateDismissals).mockResolvedValue([dismissal])
    const wrapper = mountView()
    await flushPromises()

    const toggle = wrapper.findAll('button').find((button) => button.text().includes('dismissed pair'))!
    await toggle.trigger('click')

    const row = wrapper.get('li.bg-secondary').text()
    expect(row).toContain('Other editions')
    expect(row).toContain('The Hobbit (Allen & Unwin · 1937)')
    expect(row).toContain('The Hobbit (Rob Inglis)')
  })
})
