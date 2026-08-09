import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { HardcoverLinkedBook } from '@bookorbit/types'
import HardcoverLinkedBooks from '../HardcoverLinkedBooks.vue'

const mocks = vi.hoisted(() => ({
  fetchHardcoverLinkedBooks: vi.fn<() => Promise<{ books: HardcoverLinkedBook[]; truncated: boolean }>>(),
  fetchHardcoverEditions: vi.fn<(bookId: number) => Promise<{ editions: unknown[]; truncated: boolean }>>(),
  setHardcoverEdition: vi.fn<(bookId: number, editionId: number) => Promise<{ success: boolean }>>(),
}))

function linkedBooks(books: HardcoverLinkedBook[], truncated = false) {
  return { books, truncated }
}

function editions(rows: unknown[], truncated = false) {
  return { editions: rows, truncated }
}

const toastSuccess = vi.hoisted(() => vi.fn<(message: string) => void>())
const toastError = vi.hoisted(() => vi.fn<(message: string) => void>())

vi.mock('../../api/hardcover.api', () => mocks)

vi.mock('vue-sonner', () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
    info: vi.fn<(message: string) => void>(),
  },
}))

function makeBook(overrides: Partial<HardcoverLinkedBook> = {}): HardcoverLinkedBook {
  return {
    bookId: 12,
    title: 'A Parade of Horribles',
    authorName: 'Matt Dinniman',
    hardcoverBookId: 100,
    hardcoverEditionId: 200,
    matchMethod: 'cached',
    matchError: null,
    ...overrides,
  }
}

describe('HardcoverLinkedBooks', () => {
  let wrappers: Array<{ unmount: () => void }> = []

  function mountList() {
    const wrapper = mount(HardcoverLinkedBooks)
    wrappers.push(wrapper)
    return wrapper
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchHardcoverLinkedBooks.mockResolvedValue(linkedBooks([makeBook()]))
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
    ['metadata_id', 'Linked (Metadata match)'],
  ])('presents the %s match method with proper casing', async (matchMethod, expected) => {
    mocks.fetchHardcoverLinkedBooks.mockResolvedValue(linkedBooks([makeBook({ matchMethod })]))
    const wrapper = mountList()
    await flushPromises()

    expect(wrapper.text()).toContain(expected)
  })

  it('shows an empty state when no books are being read', async () => {
    mocks.fetchHardcoverLinkedBooks.mockResolvedValue(linkedBooks([]))
    const wrapper = mountList()
    await flushPromises()

    expect(wrapper.text()).toContain('No books currently being read.')
  })

  it('shows a retryable error state instead of an unhandled rejection when loading fails', async () => {
    mocks.fetchHardcoverLinkedBooks.mockRejectedValueOnce(new Error('network down'))
    const wrapper = mountList()
    await flushPromises()

    expect(wrapper.text()).toContain('Failed to load books.')

    mocks.fetchHardcoverLinkedBooks.mockResolvedValueOnce(linkedBooks([makeBook()]))
    const retry = wrapper.findAll('button').find((b) => b.text() === 'Retry')
    await retry!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('A Parade of Horribles')
  })

  it('shows a not-yet-matched hint for books without a hardcoverBookId', async () => {
    mocks.fetchHardcoverLinkedBooks.mockResolvedValue(linkedBooks([makeBook({ hardcoverBookId: null, hardcoverEditionId: null, matchMethod: null })]))
    const wrapper = mountList()
    await flushPromises()

    await wrapper.find('button').trigger('click')

    expect(wrapper.text()).toContain("hasn't been matched to Hardcover yet")
    expect(wrapper.text()).not.toContain('View editions')
  })

  it('lists editions and lets the user switch to a different one', async () => {
    const wrapper = mountList()
    await flushPromises()

    mocks.fetchHardcoverEditions.mockResolvedValue(
      editions([
        {
          id: 200,
          title: 'First Printing',
          format: 'Physical Book',
          pages: 478,
          isbn10: null,
          isbn13: '9781234567890',
          publisher: 'Ace Books',
          language: 'en',
          publishedDate: '2024-03-12',
          coverUrl: 'https://assets.hardcover.app/covers/200.jpg',
        },
        {
          id: 201,
          title: 'Audiobook Edition',
          format: 'Audiobook',
          pages: null,
          isbn10: null,
          isbn13: null,
          publisher: null,
          language: null,
          publishedDate: null,
          coverUrl: null,
        },
      ]),
    )

    await wrapper.find('button').trigger('click')
    const viewEditions = wrapper.findAll('button').find((b) => b.text().includes('View editions'))
    await viewEditions!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('ISBN 9781234567890')
    expect(wrapper.text()).toContain('Ace Books')
    expect(wrapper.text()).toContain('First Printing')
    const cover = wrapper.find('img[src="https://assets.hardcover.app/covers/200.jpg"]')
    expect(cover.exists()).toBe(true)

    // edition 200 is the currently selected edition (matches hardcoverEditionId in makeBook)
    const currentButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Current')
    expect(currentButton).toBeDefined()

    mocks.setHardcoverEdition.mockResolvedValue({ success: true })
    mocks.fetchHardcoverLinkedBooks.mockResolvedValue(linkedBooks([makeBook({ hardcoverEditionId: 201 })]))
    const useThisButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Use this')
    await useThisButton!.trigger('click')
    await flushPromises()

    expect(mocks.setHardcoverEdition).toHaveBeenCalledWith(12, 201)
    expect(toastSuccess).toHaveBeenCalledWith('Switched to Audiobook')

    // The panel stays open so the refreshed "Current" marker lands where the user is looking.
    expect(wrapper.text()).toContain('Audiobook Edition')
    expect(wrapper.findAll('button').find((b) => b.text().trim() === 'Current')).toBeDefined()
  })

  it('shows an error toast when setting the edition is rejected by the server', async () => {
    const wrapper = mountList()
    await flushPromises()

    mocks.fetchHardcoverEditions.mockResolvedValue(editions([{ id: 201, format: 'Audiobook' }]))

    await wrapper.find('button').trigger('click')
    const viewEditions = wrapper.findAll('button').find((b) => b.text().includes('View editions'))
    await viewEditions!.trigger('click')
    await flushPromises()

    mocks.setHardcoverEdition.mockRejectedValueOnce(new Error('Failed to set Hardcover edition'))
    const useThisButton = wrapper.findAll('button').find((b) => b.text().trim() === 'Use this')
    await useThisButton!.trigger('click')
    await flushPromises()

    expect(toastError).toHaveBeenCalledWith('Failed to switch edition')
  })

  it('exposes the expanded state of each book row to assistive technology', async () => {
    const wrapper = mountList()
    await flushPromises()

    const toggle = wrapper.find('button')
    expect(toggle.attributes('aria-expanded')).toBe('false')

    await toggle.trigger('click')

    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find(`#${toggle.attributes('aria-controls')}`).exists()).toBe(true)
  })

  it('announces load failures rather than only showing them', async () => {
    mocks.fetchHardcoverLinkedBooks.mockRejectedValueOnce(new Error('network down'))
    const wrapper = mountList()
    await flushPromises()

    expect(wrapper.find('[role="alert"]').text()).toContain('Failed to load books.')
  })

  it('says so when the book list is capped instead of presenting it as complete', async () => {
    mocks.fetchHardcoverLinkedBooks.mockResolvedValue(linkedBooks([makeBook()], true))
    const wrapper = mountList()
    await flushPromises()

    expect(wrapper.text()).toContain('Showing the first 1 books')
  })

  it('says so when the edition list is capped', async () => {
    const wrapper = mountList()
    await flushPromises()

    mocks.fetchHardcoverEditions.mockResolvedValue(editions([{ id: 201, format: 'Audiobook' }], true))

    await wrapper.find('button').trigger('click')
    const viewEditions = wrapper.findAll('button').find((b) => b.text().includes('View editions'))
    await viewEditions!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Showing the first 1 editions.')
  })

  it('shows a retryable error instead of an unhandled rejection when loading editions fails', async () => {
    const wrapper = mountList()
    await flushPromises()

    mocks.fetchHardcoverEditions.mockRejectedValueOnce(new Error('provider down'))

    await wrapper.find('button').trigger('click')
    const viewEditions = wrapper.findAll('button').find((b) => b.text().includes('View editions'))
    await viewEditions!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Failed to load editions.')

    mocks.fetchHardcoverEditions.mockResolvedValueOnce(editions([{ id: 201, format: 'Audiobook' }]))
    const retry = wrapper.findAll('button').find((b) => b.text() === 'Retry')
    await retry!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Audiobook')
  })
})
