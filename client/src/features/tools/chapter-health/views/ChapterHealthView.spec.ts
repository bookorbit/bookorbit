import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { ChapterHealthBook, ChapterHealthSummary, ChapterLookupQueueState } from '@bookorbit/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const permissions = ref<string[]>(['library_edit_metadata'])
const libraries = ref([
  { id: 1, name: 'Audiobooks', accessLevel: 'owner' },
  { id: 2, name: 'Kids', accessLevel: 'editor' },
  { id: 4, name: 'Shared', accessLevel: 'viewer' },
])
const fetchLibraries = vi.fn<() => Promise<void>>()

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (name: string) => permissions.value.includes(name), isSuperuser: computed(() => false) }),
}))

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({ libraries, fetchLibraries }),
}))

vi.mock('../../api/chapter-health', () => ({
  cancelChapterLookups: vi.fn<(...args: unknown[]) => unknown>(),
  clearFinishedChapterLookups: vi.fn<(...args: unknown[]) => unknown>(),
  dismissChapterReview: vi.fn<(...args: unknown[]) => unknown>(),
  enqueueChapterLookups: vi.fn<(...args: unknown[]) => unknown>(),
  getChapterHealthBooks: vi.fn<(...args: unknown[]) => unknown>(),
  getChapterHealthSummary: vi.fn<(...args: unknown[]) => unknown>(),
  getChapterLookupState: vi.fn<(...args: unknown[]) => unknown>(),
}))

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn<(...args: unknown[]) => void>(), error: vi.fn<(...args: unknown[]) => void>() } }))

import { toast } from 'vue-sonner'
import { setI18nLocale } from '@/i18n'
import { ApiError } from '@/lib/api-json'
import * as api from '../../api/chapter-health'
import ChapterHealthView from './ChapterHealthView.vue'

const summary: ChapterHealthSummary = {
  counts: { no_chapters: 3, one_per_file: 2, numbered_tracks: 0, needs_review: 1, edited: 1_250 },
  withAsin: { no_chapters: 2, one_per_file: 1, numbered_tracks: 0, needs_review: 1, edited: 0 },
}

const idle: ChapterLookupQueueState = { queued: 0, processing: null, finished: { applied: 0, review: 0, not_found: 0, failed: 0, skipped: 0 } }

function book(bookId: number, overrides: Partial<ChapterHealthBook> = {}): ChapterHealthBook {
  return {
    bookId,
    title: `Book ${bookId}`,
    authors: ['Someone'],
    libraryName: 'Audiobooks',
    audioFiles: 1,
    chapterCount: 0,
    source: null,
    audibleId: `B0000000${bookId}`,
    review: null,
    ...overrides,
  }
}

let wrapper: VueWrapper | null = null

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/book/:bookId', name: 'book-detail', component: { template: '<div />' } },
    ],
  })
  wrapper = mount(ChapterHealthView, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

function buttonNamed(name: string) {
  return wrapper!.findAll('button').find((candidate) => candidate.text().trim() === name)
}

function lookupButton() {
  return wrapper!.findAll('button').find((candidate) => candidate.text().startsWith('Look up'))
}

describe('ChapterHealthView', () => {
  beforeEach(async () => {
    await setI18nLocale('en')
    permissions.value = ['library_edit_metadata']
    vi.mocked(api.getChapterHealthSummary).mockResolvedValue(summary)
    vi.mocked(api.getChapterHealthBooks).mockResolvedValue({ items: [book(1), book(2)], total: 2 })
    vi.mocked(api.getChapterLookupState).mockResolvedValue(idle)
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.resetAllMocks()
  })

  it('refuses the tool without the metadata permission', async () => {
    permissions.value = ['library_delete_books']
    await mountView()

    expect(wrapper!.get('[role="alert"]').text()).toBe('You need permission to edit metadata to use this tool.')
    expect(api.getChapterHealthSummary).not.toHaveBeenCalled()
    expect(fetchLibraries).not.toHaveBeenCalled()
  })

  it('shows a tab per category with its count, the first one selected', async () => {
    await mountView()

    const tabs = wrapper!.findAll('[role="tab"]')
    expect(tabs.map((tab) => tab.findAll('span').map((part) => part.text()))).toEqual([
      ['No chapters', '3'],
      ['One per file', '2'],
      ['Numbered tracks', '0'],
      ['Needs review', '1'],
      ['Edited', '1,250'],
    ])
    expect(tabs[0]!.attributes('aria-selected')).toBe('true')
    expect(tabs[1]!.attributes('aria-selected')).toBe('false')
  })

  it('explains the category and lists its books', async () => {
    await mountView()

    expect(wrapper!.text()).toContain('Audiobooks in a single file with one chapter or none.')
    expect(wrapper!.text()).toContain('2 books')
    expect(wrapper!.findAll('li').map((row) => row.find('a').text())).toEqual(['Book 1', 'Book 2'])
    expect(wrapper!.findAll('li input[type="checkbox"]')).toHaveLength(2)
  })

  it('says when a category is empty', async () => {
    vi.mocked(api.getChapterHealthBooks).mockResolvedValue({ items: [], total: 0 })
    await mountView()

    expect(wrapper!.text()).toContain('Nothing here')
    expect(wrapper!.text()).toContain('No books here')
    expect(wrapper!.find('li').exists()).toBe(false)
  })

  it('offers the lookup for the books with an ASIN in the category', async () => {
    await mountView()

    expect(lookupButton()!.text()).toBe('Look up the 2 books with an ASIN')
    expect(wrapper!.text()).toContain('No lookups waiting.')
  })

  it('hides the lookup and the checkboxes in the review list', async () => {
    vi.mocked(api.getChapterHealthBooks).mockResolvedValue({
      items: [book(4, { review: { reason: 'not_exact', summary: null } })],
      total: 1,
    })
    await mountView()

    await wrapper!.findAll('[role="tab"]')[3]!.trigger('click')
    await flushPromises()

    expect(api.getChapterHealthBooks).toHaveBeenLastCalledWith({ category: 'needs_review', libraryId: null, page: 1, pageSize: 50 })
    expect(wrapper!.findAll('[role="tab"]')[3]!.attributes('aria-selected')).toBe('true')
    expect(wrapper!.text()).toContain('Audible lookups that did not match your files well enough to apply on their own.')
    expect(lookupButton()).toBeUndefined()
    expect(wrapper!.find('li input[type="checkbox"]').exists()).toBe(false)
    expect(wrapper!.text()).toContain('Audible does not mark these timings as exact.')
  })

  it('queues the category and says how many were queued', async () => {
    vi.mocked(api.enqueueChapterLookups).mockResolvedValue({ queued: 2, skipped: 0 })
    await mountView()

    await lookupButton()!.trigger('click')
    await flushPromises()

    expect(api.enqueueChapterLookups).toHaveBeenCalledWith({ category: 'no_chapters' })
    expect(toast.success).toHaveBeenCalledWith('2 books queued')
  })

  it('names the books left out for want of an ASIN', async () => {
    vi.mocked(api.enqueueChapterLookups).mockResolvedValue({ queued: 1, skipped: 1 })
    await mountView()

    await lookupButton()!.trigger('click')
    await flushPromises()

    expect(toast.success).toHaveBeenCalledWith('1 book queued; 1 had no ASIN')
  })

  it('queues only the selected books', async () => {
    vi.mocked(api.enqueueChapterLookups).mockResolvedValue({ queued: 1, skipped: 0 })
    await mountView()

    await wrapper!.findAll('li input[type="checkbox"]')[1]!.setValue(true)
    expect(lookupButton()!.text()).toBe('Look up 1 selected book')
    expect(buttonNamed('Clear selection')).toBeDefined()

    await lookupButton()!.trigger('click')
    await flushPromises()

    expect(api.enqueueChapterLookups).toHaveBeenCalledWith({ bookIds: [2] })
    expect(toast.success).toHaveBeenCalledWith('1 book queued')
    expect(lookupButton()!.text()).toBe('Look up the 2 books with an ASIN')
  })

  it('toasts when the lookups could not be queued', async () => {
    vi.mocked(api.enqueueChapterLookups).mockRejectedValue(new ApiError('nope', 500, null, null))
    await mountView()

    await lookupButton()!.trigger('click')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith('The lookups could not be queued.')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('narrows to one library, leaving out ones the user cannot edit', async () => {
    await mountView()

    const select = wrapper!.get('select')
    expect(select.findAll('option').map((option) => option.text())).toEqual(['All libraries', 'Audiobooks', 'Kids'])

    await select.setValue('2')
    await flushPromises()

    expect(api.getChapterHealthSummary).toHaveBeenLastCalledWith(2)
    expect(api.getChapterHealthBooks).toHaveBeenLastCalledWith({ category: 'no_chapters', libraryId: 2, page: 1, pageSize: 50 })
  })

  it('dismisses a review and reloads the list', async () => {
    vi.mocked(api.getChapterHealthBooks).mockResolvedValue({
      items: [book(4, { review: { reason: 'implausible', summary: null } })],
      total: 1,
    })
    vi.mocked(api.dismissChapterReview).mockResolvedValue(undefined)
    await mountView()
    vi.mocked(api.getChapterHealthSummary).mockClear()

    await buttonNamed('Dismiss')!.trigger('click')
    await flushPromises()

    expect(api.dismissChapterReview).toHaveBeenCalledWith(4)
    expect(api.getChapterHealthSummary).toHaveBeenCalledTimes(1)
  })

  it('offers Clear only for outcomes it can clear, not for reviews still waiting', async () => {
    vi.mocked(api.getChapterLookupState).mockResolvedValue({ ...idle, finished: { ...idle.finished, review: 1 } })
    await mountView()

    expect(wrapper!.text()).toContain('Finished: 0 applied, 1 to review, 0 not found, 0 failed')
    expect(buttonNamed('Clear')).toBeUndefined()

    wrapper!.unmount()
    vi.mocked(api.getChapterLookupState).mockResolvedValue({ ...idle, finished: { ...idle.finished, review: 1, applied: 2 } })
    await mountView()

    expect(buttonNamed('Clear')).toBeDefined()
  })
})
