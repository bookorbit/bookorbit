import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import type { StorygraphActiveSyncStatus, StorygraphLinkedBook } from '@bookorbit/types'
import StorygraphLinkedBooks from '../StorygraphLinkedBooks.vue'

const lastRunSummary = ref<StorygraphActiveSyncStatus | null>(null)

const mocks = vi.hoisted(() => ({
  fetchStorygraphLinkedBooks: vi.fn<() => Promise<StorygraphLinkedBook[]>>(),
  fetchStorygraphEditions: vi.fn<(bookId: number) => Promise<unknown[]>>(),
  linkStorygraphBook: vi.fn<(bookId: number, input: string) => Promise<{ success: boolean; storygraphBookId?: string; title?: string }>>(),
  rematchStorygraphBook: vi.fn<(bookId: number) => Promise<{ result: string }>>(),
  setStorygraphEdition: vi.fn<(bookId: number, editionId: string) => Promise<{ success: boolean }>>(),
}))

const toastSuccess = vi.hoisted(() => vi.fn<(message: string) => void>())
const toastError = vi.hoisted(() => vi.fn<(message: string) => void>())

vi.mock('../../api/storygraph.api', () => mocks)

vi.mock('../../composables/useStorygraphSync', () => ({
  useStorygraphSync: () => ({ lastRunSummary }),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
    info: vi.fn<(message: string) => void>(),
  },
}))

function makeBook(overrides: Partial<StorygraphLinkedBook> = {}): StorygraphLinkedBook {
  return {
    bookId: 12,
    title: 'A Parade of Horribles',
    author: 'Matt Dinniman',
    storygraphBookId: 'sg-1',
    matchMethod: 'cached',
    matchError: null,
    ...overrides,
  } as StorygraphLinkedBook
}

describe('StorygraphLinkedBooks', () => {
  let wrappers: Array<{ unmount: () => void }> = []

  function mountList() {
    const wrapper = mount(StorygraphLinkedBooks)
    wrappers.push(wrapper)
    return wrapper
  }

  beforeEach(() => {
    vi.clearAllMocks()
    lastRunSummary.value = null
    mocks.fetchStorygraphLinkedBooks.mockResolvedValue([makeBook()])
  })

  afterEach(() => {
    for (const wrapper of wrappers) wrapper.unmount()
    wrappers = []
    vi.restoreAllMocks()
  })

  it('renders the linked books returned by the API', async () => {
    const wrapper = mountList()
    await flushPromises()

    expect(wrapper.text()).toContain('A Parade of Horribles')
    expect(wrapper.text()).toContain('Linked (Cached)')
  })

  it.each([
    ['isbn', 'Linked (ISBN)'],
    ['title', 'Linked (Title)'],
    ['manual', 'Linked (Manual)'],
  ])('presents the %s match method with proper casing', async (matchMethod, expected) => {
    mocks.fetchStorygraphLinkedBooks.mockResolvedValue([makeBook({ matchMethod: matchMethod as StorygraphLinkedBook['matchMethod'] })])
    const wrapper = mountList()
    await flushPromises()

    expect(wrapper.text()).toContain(expected)
  })

  it('labels the manual-link field for a StoryGraph URL or book ID', async () => {
    mocks.fetchStorygraphLinkedBooks.mockResolvedValue([makeBook({ storygraphBookId: null, matchMethod: null })])
    const wrapper = mountList()
    await flushPromises()

    await wrapper.find('button').trigger('click')

    expect(wrapper.find('input[type="text"]').attributes('placeholder')).toBe('Paste a StoryGraph URL or book ID')
  })

  it('shows an empty state when no books are being read', async () => {
    mocks.fetchStorygraphLinkedBooks.mockResolvedValue([])
    const wrapper = mountList()
    await flushPromises()

    expect(wrapper.text()).toContain('No books currently being read.')
  })

  it('shows a retryable error state instead of an unhandled rejection when loading fails', async () => {
    mocks.fetchStorygraphLinkedBooks.mockRejectedValueOnce(new Error('network down'))
    const wrapper = mountList()
    await flushPromises()

    expect(wrapper.text()).toContain('Failed to load books.')

    mocks.fetchStorygraphLinkedBooks.mockResolvedValueOnce([makeBook()])
    const retry = wrapper.findAll('button').find((b) => b.text() === 'Retry')
    await retry!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('A Parade of Horribles')
  })

  it('shows distinguishing edition identifiers in the editions list', async () => {
    const wrapper = mountList()
    await flushPromises()

    mocks.fetchStorygraphEditions.mockResolvedValue([
      {
        id: 'sg-1',
        title: 'First Printing',
        format: 'Hardcover',
        pages: 478,
        isAudio: false,
        language: 'English',
        isbn: '9781234567890',
        publisher: 'Ace Books',
        publicationDate: '12 March 2024',
        coverUrl: 'https://cdn.thestorygraph.com/covers/sg-1.jpg',
      },
      {
        id: 'sg-9',
        title: 'Special Edition',
        format: 'Hardcover',
        pages: 478,
        isAudio: false,
        language: 'English',
        isbn: '9780987654321',
        publisher: null,
        publicationDate: null,
        coverUrl: null,
      },
    ])

    await wrapper.find('button').trigger('click')
    const viewEditions = wrapper.findAll('button').find((b) => b.text().includes('View editions'))
    await viewEditions!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('ISBN 9781234567890')
    expect(wrapper.text()).toContain('ISBN 9780987654321')
    expect(wrapper.text()).toContain('Ace Books')
    expect(wrapper.text()).toContain('12 March 2024')
    expect(wrapper.text()).toContain('First Printing')
    const editionLinks = wrapper.findAll('a[target="_blank"]').map((a) => a.attributes('href'))
    expect(editionLinks).toContain('https://app.thestorygraph.com/books/sg-9')
    const cover = wrapper.find('img[src="https://cdn.thestorygraph.com/covers/sg-1.jpg"]')
    expect(cover.exists()).toBe(true)
    // sg-1 is the currently linked edition (matches storygraphBookId in makeBook)
    const currentButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Current')
    expect(currentButton).toBeDefined()
  })

  it('reloads the list when a sync run completes', async () => {
    const wrapper = mountList()
    await flushPromises()
    mocks.fetchStorygraphLinkedBooks.mockResolvedValue([makeBook({ storygraphBookId: 'sg-new', matchMethod: 'isbn' })])
    lastRunSummary.value = {
      runId: 2,
      status: 'completed',
      syncedBooks: 2,
      skippedBooks: 0,
      failedBooks: 0,
      processedBooks: 2,
      totalBooks: 2,
    }
    await flushPromises()

    expect(mocks.fetchStorygraphLinkedBooks).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('Linked (ISBN)')
    // Silent refresh: the list stays rendered instead of flashing the loading spinner.
    expect(wrapper.text()).not.toContain('Loading books...')
  })

  it('shows a linking hint for books without a StoryGraph match', async () => {
    mocks.fetchStorygraphLinkedBooks.mockResolvedValue([makeBook({ storygraphBookId: null, matchMethod: null })])
    const wrapper = mountList()
    await flushPromises()

    await wrapper.find('button').trigger('click')

    expect(wrapper.text()).toContain("couldn't be matched to StoryGraph automatically")
    expect(wrapper.text()).toContain('Try auto-match')
  })

  it('shows an icon-only edition link instead of the raw edition id', async () => {
    const wrapper = mountList()
    await flushPromises()

    mocks.fetchStorygraphEditions.mockResolvedValue([
      {
        id: 'sg-1',
        title: 'First Printing',
        format: 'Hardcover',
        pages: 478,
        isAudio: false,
        language: 'English',
        isbn: '9781234567890',
        publisher: null,
        publicationDate: null,
        coverUrl: null,
      },
    ])

    await wrapper.find('button').trigger('click')
    const viewEditions = wrapper.findAll('button').find((b) => b.text().includes('View editions'))
    await viewEditions!.trigger('click')
    await flushPromises()

    const link = wrapper.find('a[href="https://app.thestorygraph.com/books/sg-1"]')
    expect(link.exists()).toBe(true)
    expect(link.text().trim()).toBe('')
    expect(link.attributes('aria-label')).toBe('Open on StoryGraph')
    expect(link.attributes('target')).toBe('_blank')
  })

  it('does not misattribute a reload failure to a successful link action', async () => {
    const wrapper = mountList()
    await flushPromises()

    await wrapper.find('button').trigger('click')
    const input = wrapper.find('input')
    await input.setValue('https://app.thestorygraph.com/books/sg-2')

    mocks.linkStorygraphBook.mockResolvedValue({ success: true, storygraphBookId: 'sg-2', title: 'Linked Title' })
    mocks.fetchStorygraphLinkedBooks.mockRejectedValueOnce(new Error('reload failed'))

    const linkButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Link')
    await linkButton!.trigger('click')
    await flushPromises()

    expect(toastSuccess).toHaveBeenCalledWith('Linked: Linked Title')
    expect(toastError).not.toHaveBeenCalledWith('Failed to link StoryGraph book')
    expect(wrapper.text()).toContain('Failed to load books.')
  })
})
