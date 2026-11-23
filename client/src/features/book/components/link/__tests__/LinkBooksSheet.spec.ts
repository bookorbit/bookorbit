import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import type { BookCard, BookEditionSuggestion, BookLinkGroup, Library } from '@bookorbit/types'
import { i18n } from '@/i18n'
import LinkBooksSheet from '../LinkBooksSheet.vue'
import type { LinkSeedBook } from '@/features/book/lib/book-link'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  toast: {
    success: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>(),
  },
}))

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: mocks.api,
}))

vi.mock('vue-sonner', () => ({ toast: mocks.toast }))

const libraries = ref<Library[]>([])
vi.mock('@/features/library/composables/useLibraries', () => ({ useLibraries: () => ({ libraries }) }))
vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true, isSuperuser: ref(false) }),
}))

const stubs = {
  Sheet: { props: ['open'], template: '<div v-if="open"><slot /></div>' },
  SheetContent: { template: '<div role="dialog"><slot /></div>' },
  SheetHeader: { template: '<div><slot /></div>' },
  SheetTitle: { template: '<h2><slot /></h2>' },
  SheetDescription: { template: '<p><slot /></p>' },
  BookCoverImage: true,
}

function card(id: number, libraryId: number, title: string, format: string): BookCard {
  return {
    id,
    libraryId,
    title,
    authors: ['Frank Herbert'],
    hasCover: false,
    files: [{ id: id * 10, format, role: 'primary', sizeBytes: null }],
  } as unknown as BookCard
}

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

const group: BookLinkGroup = {
  groupId: 7,
  leadBookId: 1,
  books: [
    { bookId: 1, libraryId: 2, libraryName: 'Ebooks', title: 'Dune', formats: ['epub'], mediaKind: 'ebook', status: 'present', isLead: true },
    { bookId: 2, libraryId: 3, libraryName: 'Audiobooks', title: 'Dune', formats: ['m4b'], mediaKind: 'audiobook', status: 'present', isLead: false },
  ],
}

let wrapper: VueWrapper | null = null

function mountSheet(props: { bookIds: number[]; books?: BookCard[]; seedBooks?: LinkSeedBook[]; picker?: boolean; excludeIds?: number[] }) {
  wrapper = mount(LinkBooksSheet, { props: { open: true, ...props }, global: { stubs } })
  return wrapper
}

beforeEach(() => {
  i18n.global.locale.value = 'en'
  mocks.api.mockReset()
  mocks.toast.success.mockReset()
  libraries.value = [
    { id: 2, name: 'Ebooks', accessLevel: 'editor' },
    { id: 3, name: 'Audiobooks', accessLevel: 'editor' },
  ] as Library[]
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('LinkBooksSheet from a selection', () => {
  const books = [card(1, 2, 'Dune', 'epub'), card(2, 3, 'Dune', 'm4b')]

  it('lists the selected books with their libraries and links them in grid order', async () => {
    mocks.api.mockResolvedValue(json(200, group))
    const sheet = mountSheet({ bookIds: [1, 2], books })

    const list = sheet.get('[data-testid="link-books-list"]')
    expect(list.text()).toContain('In Ebooks')
    expect(list.text()).toContain('In Audiobooks')
    expect(sheet.get('[data-testid="link-confirm"]').text()).toBe('Group 2 editions')

    await sheet.get('[data-testid="link-confirm"]').trigger('click')
    await flushPromises()

    const [url, init] = mocks.api.mock.calls[0]!
    expect(url).toBe('/api/v1/books/links')
    expect(init).toEqual(expect.objectContaining({ method: 'POST', body: JSON.stringify({ bookIds: [1, 2] }) }))
    expect(sheet.emitted('linked')).toEqual([[group]])
    expect(sheet.emitted('update:open')).toEqual([[false]])
    expect(mocks.toast.success).toHaveBeenCalledWith('Grouped 2 editions')
  })

  it('counts selected books whose cards are not loaded', () => {
    const sheet = mountSheet({ bookIds: [1, 2, 3], books })
    expect(sheet.text()).toContain('And 1 more selected book')
  })

  it('shows a refusal in words and stays open', async () => {
    mocks.api.mockResolvedValue(json(409, { errorCode: 'LINK_GROUP_NOT_EDITABLE', message: 'server text' }))
    const sheet = mountSheet({ bookIds: [1, 2], books })

    await sheet.get('[data-testid="link-confirm"]').trigger('click')
    await flushPromises()

    expect(sheet.get('[data-testid="link-error"]').text()).toBe('One of these books is grouped with an edition you cannot edit.')
    expect(sheet.get('[data-testid="link-error"]').attributes('role')).toBe('alert')
    expect(sheet.emitted('linked')).toBeUndefined()
    expect(sheet.emitted('update:open')).toBeUndefined()
  })

  it('falls back to its own wording for an error without a known code', async () => {
    mocks.api.mockResolvedValue(json(500, {}))
    const sheet = mountSheet({ bookIds: [1, 2], books })

    await sheet.get('[data-testid="link-confirm"]').trigger('click')
    await flushPromises()

    expect(sheet.get('[data-testid="link-error"]').text()).toBe('The editions could not be grouped.')
  })

  it('names a full group in edition words, with the limit the server sent', async () => {
    mocks.api.mockResolvedValue(json(409, { errorCode: 'LINK_GROUP_FULL', errorMeta: { max: 10 }, message: 'server text' }))
    const sheet = mountSheet({ bookIds: [1, 2], books })

    await sheet.get('[data-testid="link-confirm"]').trigger('click')
    await flushPromises()

    expect(sheet.get('[data-testid="link-error"]').text()).toBe('A book can have at most 10 editions. Remove some first.')
  })

  it('names the first book the main edition when none is grouped yet', () => {
    const sheet = mountSheet({ bookIds: [1, 2], books })
    const rows = sheet.get('[data-testid="link-books-list"]').findAll('li')
    expect(rows[0]!.find('[data-testid="link-main-badge"]').exists()).toBe(true)
    expect(rows[1]!.find('[data-testid="link-main-badge"]').exists()).toBe(false)
  })

  it('counts the editions a grouped book brings along and names no main edition of its own', () => {
    const grouped = {
      ...card(1, 2, 'Dune', 'epub'),
      linked: { groupId: 7, books: [{ bookId: 9, libraryId: 3, formats: ['m4b'], mediaKind: 'audiobook' }], memberCount: 2 },
    } as BookCard
    const sheet = mountSheet({ bookIds: [1, 2], books: [grouped, card(2, 3, 'Dune', 'm4b')] })

    expect(sheet.get('[data-testid="link-confirm"]').text()).toBe('Group 3 editions')
    expect(sheet.find('[data-testid="link-main-badge"]').exists()).toBe(false)
  })

  it('refuses a grouping that would pass the edition limit before asking the server', () => {
    const others = Array.from({ length: 9 }, (_, i) => ({ bookId: 100 + i, libraryId: 3, formats: ['epub'], mediaKind: 'ebook' as const }))
    const grouped = { ...card(1, 2, 'Dune', 'epub'), linked: { groupId: 7, books: others, memberCount: 10 } } as BookCard
    const sheet = mountSheet({ bookIds: [1, 2], books: [grouped, card(2, 3, 'Dune', 'm4b')] })

    expect(sheet.get('[data-testid="link-over-limit"]').text()).toBe('That makes 11 editions, more than the 10 a book can have.')
    expect(sheet.get('[data-testid="link-confirm"]').attributes('disabled')).toBeDefined()
  })
})

describe('LinkBooksSheet from a blocked merge', () => {
  it('lists the merge books by name, the kept one first, and links them without picking again', async () => {
    mocks.api.mockResolvedValue(json(200, group))
    const sheet = mountSheet({
      bookIds: [2, 1],
      seedBooks: [
        { id: 2, title: 'Dune', libraryId: 3, formats: ['m4b'] },
        { id: 1, title: 'Dune', libraryId: 2, formats: ['epub'] },
      ],
    })

    const rows = sheet.get('[data-testid="link-books-list"]').findAll('li')
    expect(rows.map((row) => row.text())).toEqual([expect.stringContaining('In Audiobooks'), expect.stringContaining('In Ebooks')])
    expect(rows[0]!.text()).toContain('M4B')
    expect(sheet.find('input[type="search"]').exists()).toBe(false)

    await sheet.get('[data-testid="link-confirm"]').trigger('click')
    await flushPromises()
    expect(mocks.api.mock.calls[0]![1]).toEqual(expect.objectContaining({ body: JSON.stringify({ bookIds: [2, 1] }) }))
  })
})

describe('LinkBooksSheet from the detail page', () => {
  it('cannot link until another book is picked', () => {
    const sheet = mountSheet({ bookIds: [1], picker: true, excludeIds: [5] })
    expect(sheet.find('[data-testid="link-books-list"]').exists()).toBe(false)
    expect(sheet.get('[data-testid="link-confirm"]').attributes('disabled')).toBeDefined()
    expect(sheet.get('[data-testid="link-confirm"]').text()).toBe('Group editions')
  })

  it('searches every library and offers only books in libraries the user can edit', async () => {
    // The clock stays real: Vue drops DOM events stamped earlier than the listener was attached.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    libraries.value = [
      { id: 2, name: 'Ebooks', accessLevel: 'editor' },
      { id: 3, name: 'Audiobooks', accessLevel: 'editor' },
      { id: 4, name: 'Shared', accessLevel: 'viewer' },
    ] as Library[]
    const page = {
      items: [card(1, 2, 'Dune', 'epub'), card(2, 3, 'Dune', 'm4b'), card(3, 4, 'Dune', 'pdf'), card(5, 3, 'Dune', 'mp3')],
      total: 4,
      page: 0,
      size: 20,
    }
    mocks.api.mockImplementation(async (input) => json(200, String(input).endsWith('/edition-suggestions') ? { items: [] } : page))
    const sheet = mountSheet({ bookIds: [1], picker: true, excludeIds: [5] })

    await sheet.get('input[type="search"]').setValue('dune')
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()
    vi.useRealTimers()

    const [url, init] = mocks.api.mock.calls.find(([input]) => String(input) === '/api/v1/books/query')!
    expect(url).toBe('/api/v1/books/query')
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('collapseLinked')

    const results = sheet.get('[data-testid="link-picker-results"]')
    // The open book, a book already linked with it, and a book in a viewer-only library are left out.
    expect(results.findAll('li')).toHaveLength(1)
    expect(results.text()).toContain('In Audiobooks')

    await results.get('input[type="checkbox"]').setValue(true)
    await flushPromises()
    // The open book's existing edition (5) joins too, so the count covers all three.
    expect(sheet.get('[data-testid="link-confirm"]').text()).toBe('Group 3 editions')

    mocks.api.mockResolvedValue(json(200, group))
    await sheet.get('[data-testid="link-confirm"]').trigger('click')
    await flushPromises()
    expect(JSON.parse(String(mocks.api.mock.calls.at(-1)![1]?.body))).toEqual({ bookIds: [1, 2] })
  })

  function suggestion(book: BookCard, kind: BookEditionSuggestion['kind'], reasons: BookEditionSuggestion['reasons']): BookEditionSuggestion {
    return { book, kind, reasons }
  }

  function serveSuggestions(items: BookEditionSuggestion[], page: BookCard[] = []) {
    mocks.api.mockImplementation(async (input) =>
      json(200, String(input).endsWith('/edition-suggestions') ? { items } : { items: page, total: page.length, page: 0, size: 20 }),
    )
  }

  it('lists likely editions before anything is typed, each saying why, and groups a picked one', async () => {
    libraries.value = [
      { id: 2, name: 'Ebooks', accessLevel: 'editor' },
      { id: 3, name: 'Audiobooks', accessLevel: 'editor' },
      { id: 4, name: 'Shared', accessLevel: 'viewer' },
    ] as Library[]
    serveSuggestions([
      suggestion(card(2, 3, 'Dune', 'm4b'), 'other_format', ['same_work', 'title_author']),
      suggestion(card(6, 2, 'Dune', 'epub'), 'other_edition', ['title_author']),
      suggestion(card(5, 3, 'Dune', 'mp3'), 'other_format', ['title_author']),
      suggestion(card(3, 4, 'Dune', 'pdf'), 'other_edition', ['same_work']),
    ])
    const sheet = mountSheet({ bookIds: [1], picker: true, excludeIds: [5] })
    await flushPromises()

    expect(mocks.api.mock.calls[0]![0]).toBe('/api/v1/books/1/edition-suggestions')
    const list = sheet.get('[data-testid="link-picker-suggestions"]')
    expect(sheet.text()).toContain('Suggested editions')
    expect(sheet.text()).not.toContain('Type to search your libraries.')
    // A book already in the group and one in a viewer-only library are left out.
    const rows = list.findAll('li')
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.get('[data-testid="link-picker-suggestion-reason"]').text())).toEqual([
      'Other formatSame work, title and author',
      'Other editionSame title and author',
    ])
    expect(list.attributes('aria-labelledby')).toBe(sheet.get('h3').attributes('id'))

    await rows[0]!.get('input[type="checkbox"]').setValue(true)
    await flushPromises()
    expect(sheet.get('[data-testid="link-confirm"]').text()).toBe('Group 3 editions')

    mocks.api.mockResolvedValue(json(200, group))
    await sheet.get('[data-testid="link-confirm"]').trigger('click')
    await flushPromises()
    expect(JSON.parse(String(mocks.api.mock.calls.at(-1)![1]?.body))).toEqual({ bookIds: [1, 2] })
  })

  it('swaps the suggestions for search results while a search is typed, and brings them back when it is cleared', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    serveSuggestions([suggestion(card(2, 3, 'Dune', 'm4b'), 'other_format', ['title_author'])], [card(7, 2, 'Dune Messiah', 'epub')])
    const sheet = mountSheet({ bookIds: [1], picker: true })
    await flushPromises()

    await sheet.get('input[type="search"]').setValue('messiah')
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()
    expect(sheet.find('[data-testid="link-picker-suggestions"]').exists()).toBe(false)
    expect(sheet.get('[data-testid="link-picker-results"]').text()).toContain('Dune Messiah')
    expect(sheet.text()).not.toContain('Suggested editions')

    await sheet.get('input[type="search"]').setValue('')
    await flushPromises()
    vi.useRealTimers()
    expect(sheet.get('[data-testid="link-picker-suggestions"]').findAll('li')).toHaveLength(1)
  })

  it('says it is looking while suggestions load, and keeps the search prompt when none are found or they fail', async () => {
    let answer: (response: Response) => void = () => {}
    mocks.api.mockImplementation(() => new Promise<Response>((resolve) => (answer = resolve)))
    const sheet = mountSheet({ bookIds: [1], picker: true })
    await flushPromises()
    expect(sheet.find('[data-testid="link-picker-suggestions-loading"]').exists()).toBe(true)

    answer(json(200, { items: [] }))
    await flushPromises()
    expect(sheet.find('[data-testid="link-picker-suggestions-loading"]').exists()).toBe(false)
    expect(sheet.find('[data-testid="link-picker-suggestions"]').exists()).toBe(false)
    expect(sheet.text()).toContain('Type to search your libraries.')

    wrapper?.unmount()
    mocks.api.mockResolvedValue(json(500, { message: 'boom' }))
    const failed = mountSheet({ bookIds: [1], picker: true })
    await flushPromises()
    expect(failed.text()).toContain('Type to search your libraries.')
    expect(failed.find('[role="alert"]').exists()).toBe(false)
  })
})
