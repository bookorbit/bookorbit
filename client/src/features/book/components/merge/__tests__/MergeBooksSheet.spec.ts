import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import type { BookCard, BookMergeJobEvent, BookMergeRequest, BookMergePreviewRequest, Library } from '@bookorbit/types'
import MergeBooksSheet from '../MergeBooksSheet.vue'
import { jsonResponse, mergeBook, mergeField, mergeJob, mergePreview } from './fixtures'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  finished: null as ((event: BookMergeJobEvent) => void) | null,
  push: vi.fn<(location: unknown) => Promise<void>>(),
  toast: {
    success: vi.fn<(message: string, options?: unknown) => void>(),
    warning: vi.fn<(message: string, options?: { action?: { label: string; onClick: () => void } }) => void>(),
    error: vi.fn<(message: string) => void>(),
    info: vi.fn<(message: string) => void>(),
  },
  permissions: new Set<string>(),
}))

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: mocks.api,
}))

vi.mock('@/features/book/composables/useBookEvents', () => ({
  useBookEvents: () => ({
    onBookMergeProgress: () => () => undefined,
    onBookMergeFinished: (callback: (event: BookMergeJobEvent) => void) => {
      mocks.finished = callback
      return () => undefined
    },
  }),
}))

vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock('vue-sonner', () => ({ toast: mocks.toast }))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (permission: string) => mocks.permissions.has(permission), isSuperuser: ref(false) }),
}))

const libraries = ref<Library[]>([])
vi.mock('@/features/library/composables/useLibraries', () => ({ useLibraries: () => ({ libraries }) }))

type Handler = () => Response | Promise<Response>

const PREVIEW_URL = '/api/v1/books/merge/preview'
const MERGE_URL = '/api/v1/books/merge'
const JOB_URL = '/api/v1/books/merge/jobs/41'

let routes: Map<string, Handler[]>
let wrapper: VueWrapper | null = null

function respond(url: string, ...handlers: Handler[]): void {
  routes.set(url, handlers)
}

function calls(url: string): RequestInit[] {
  return mocks.api.mock.calls.filter(([input]) => String(input) === url).map(([, init]) => init ?? {})
}

function bodies<T>(url: string): T[] {
  return calls(url).map((init) => JSON.parse(String(init.body)) as T)
}

const stubs = {
  Sheet: { props: ['open'], template: '<div v-if="open"><slot /></div>' },
  SheetContent: { template: '<div role="dialog"><slot /></div>' },
  SheetHeader: { template: '<div><slot /></div>' },
  SheetTitle: { template: '<h2><slot /></h2>' },
  SheetDescription: { template: '<p><slot /></p>' },
  BookCoverImage: true,
  RouterLink: { props: ['to'], template: '<a href="#"><slot /></a>' },
}

async function mountSheet(props: { bookIds?: number[]; keeperId?: number | null } = {}) {
  wrapper = mount(MergeBooksSheet, {
    props: { open: true, bookIds: [1, 2], keeperId: 1, ...props },
    global: { stubs },
  })
  await flushPromises()
  return wrapper
}

function button(testId: string) {
  return wrapper!.get(`[data-testid="${testId}"]`)
}

async function toReview() {
  await button('merge-continue').trigger('click')
  await flushPromises()
}

beforeEach(() => {
  routes = new Map()
  mocks.api.mockReset()
  mocks.api.mockImplementation(async (input) => {
    const queue = routes.get(String(input))
    const handler = queue && queue.length > 1 ? queue.shift() : queue?.[0]
    if (!handler) throw new Error(`Unexpected request ${String(input)}`)
    return handler()
  })
  mocks.push.mockReset()
  mocks.push.mockResolvedValue(undefined)
  for (const fn of Object.values(mocks.toast)) fn.mockReset()
  mocks.permissions = new Set()
  mocks.finished = null
  libraries.value = [{ id: 1, name: 'Books', accessLevel: 'editor' }] as Library[]
  respond(PREVIEW_URL, () => jsonResponse(mergePreview()))
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.useRealTimers()
})

describe('MergeBooksSheet keeper step', () => {
  it('offers each book as a radio choice with the kept book selected', async () => {
    await mountSheet()

    const cards = wrapper!.findAll('[data-testid="merge-keeper-card"]')
    expect(cards).toHaveLength(2)
    const radios = cards.map((card) => card.get('input[type="radio"]').element as HTMLInputElement)
    expect(radios.map((radio) => radio.checked)).toEqual([true, false])
    expect(new Set(radios.map((radio) => radio.name)).size).toBe(1)
    expect(wrapper!.find('[data-testid="merge-destination-summary"]').exists()).toBe(true)
  })

  it('asks for a new preview when another book is chosen to keep', async () => {
    vi.useFakeTimers()
    await mountSheet()
    respond(PREVIEW_URL, () => jsonResponse(mergePreview({ targetBookId: 2 })))

    await wrapper!.findAll('[data-testid="merge-keeper-card"] input[type="radio"]')[1]!.setValue(true)
    expect(button('merge-continue').attributes('disabled')).toBeUndefined()
    await vi.runAllTimersAsync()
    await flushPromises()

    expect(bodies<BookMergePreviewRequest>(PREVIEW_URL).at(-1)).toEqual({ targetBookId: 2, sourceBookIds: [1] })
    const radios = wrapper!.findAll<HTMLInputElement>('[data-testid="merge-keeper-card"] input[type="radio"]')
    expect(radios.map((radio) => radio.element.checked)).toEqual([false, true])
  })

  it('lets the reader pick where the files go when the kept book has no folder of its own', async () => {
    respond(PREVIEW_URL, () =>
      jsonResponse(
        mergePreview({
          books: [mergeBook(1, { folderRelPath: null, canBeDestination: false }), mergeBook(2), mergeBook(3)],
          destinationBookId: 2,
          destinationCandidates: [2, 3],
        }),
      ),
    )
    await mountSheet({ bookIds: [1, 2, 3] })

    expect(wrapper!.find('[data-testid="merge-destination-summary"]').exists()).toBe(false)
    const destinations = wrapper!.findAll('fieldset').at(-1)!.findAll<HTMLInputElement>('input[type="radio"]')
    expect(destinations.map((radio) => radio.element.checked)).toEqual([true, false])
  })
  it('names the new folder when every book is a single file at the top of the library', async () => {
    respond(PREVIEW_URL, () =>
      jsonResponse(
        mergePreview({
          books: [mergeBook(1, { folderRelPath: null, canBeDestination: false }), mergeBook(2, { folderRelPath: null, canBeDestination: false })],
          destinationBookId: 1,
          destinationCandidates: [],
          newFolderRelPath: 'Dune',
        }),
      ),
    )
    await mountSheet()

    expect(wrapper!.find('[data-testid="merge-destination-new-folder"]').exists()).toBe(true)
    expect(wrapper!.text()).toContain('Dune')
    expect(wrapper!.find('[data-testid="merge-destination-summary"]').exists()).toBe(false)
  })
})

describe('MergeBooksSheet preview details', () => {
  it('shows reading activity on the keeper cards and names the receiving library folder', async () => {
    respond(PREVIEW_URL, () =>
      jsonResponse(
        mergePreview({
          books: [
            mergeBook(1, {
              libraryFolderId: 11,
              libraryFolderName: 'Books A',
              activity: { highlights: 3, shelves: 1, hasProgress: true, readers: null },
            }),
            mergeBook(2, {
              libraryFolderId: 12,
              libraryFolderName: 'Books B',
              activity: { highlights: 0, shelves: 0, hasProgress: false, readers: null },
            }),
          ],
        }),
      ),
    )
    await mountSheet()

    const activity = wrapper!.findAll('[data-testid="merge-keeper-activity"]')
    expect(activity).toHaveLength(1)
    expect(activity[0]!.findAll('span').map((span) => span.text())).toHaveLength(3)
    expect(wrapper!.get('[data-testid="merge-destination-root"]').text()).toContain('Books A')
  })

  it('says what a busy book is doing, and nothing extra for a reason it does not know', async () => {
    respond(PREVIEW_URL, () =>
      jsonResponse(
        mergePreview({
          eligible: false,
          previewToken: null,
          blockers: [
            { code: 'BOOK_BUSY', bookId: 1, busyReason: 'read_aloud' },
            { code: 'BOOK_BUSY', bookId: 2, busyReason: 'something_new' as never },
          ],
        }),
      ),
    )
    await mountSheet()
    await toReview()

    expect(wrapper!.findAll('[data-testid="merge-blocker"]')).toHaveLength(2)
    expect(wrapper!.findAll('[data-testid="merge-blocker-detail"]')).toHaveLength(1)
  })

  it('lists the tags and genres the kept book ends with', async () => {
    respond(PREVIEW_URL, () =>
      jsonResponse(
        mergePreview({
          visibility: { tags: [], genres: [], canOverride: false, resultTags: ['Classic', 'Space'], resultGenres: ['Science Fiction'] },
        }),
      ),
    )
    await mountSheet()
    await toReview()

    const taxonomy = wrapper!.get('[data-testid="merge-result-taxonomy"]')
    expect(taxonomy.text()).toContain('Science Fiction')
    expect(taxonomy.text()).toContain('Classic')
  })
})

describe('MergeBooksSheet book picker', () => {
  const LIBRARY_BOOKS_URL = '/api/v1/books/query'

  function card(id: number): BookCard {
    return { id, libraryId: 1, title: `Book ${id}`, authors: ['Ann Author'], files: [], hasCover: false, coverVersion: '1' } as unknown as BookCard
  }

  async function pickBook(id: number) {
    respond(LIBRARY_BOOKS_URL, () => jsonResponse({ items: [card(id)], total: 1, page: 0, size: 20 }))
    await wrapper!.get('input[type="search"]').setValue('Book')
    await vi.runAllTimersAsync()
    await flushPromises()
    await wrapper!.get('[data-testid="merge-picker-results"] input[type="checkbox"]').setValue(true)
  }

  function pickedTitles(): string[] {
    return wrapper!.findAll('[data-testid="merge-picker-picked"]').map((chip) => chip.text())
  }

  it('keeps the picked books listed and removable after going back from the keeper step', async () => {
    vi.useFakeTimers()
    mocks.permissions = new Set(['library_merge_books'])
    wrapper = mount(MergeBooksSheet, {
      props: { open: true, bookIds: [1], keeperId: 1, pickerLibraryId: 1 },
      global: { stubs },
    })
    await flushPromises()
    await pickBook(2)
    expect(pickedTitles()).toEqual(['Book 2'])

    await button('merge-picker-continue').trigger('click')
    await vi.runAllTimersAsync()
    await flushPromises()
    expect(bodies<BookMergePreviewRequest>(PREVIEW_URL).at(-1)).toEqual({ targetBookId: 1, sourceBookIds: [2] })

    await wrapper!
      .findAll('button')
      .find((candidate) => candidate.text() === 'Back')!
      .trigger('click')
    await vi.runAllTimersAsync()
    await flushPromises()

    expect(pickedTitles()).toEqual(['Book 2'])
    expect(button('merge-picker-continue').attributes('disabled')).toBeUndefined()

    await wrapper!.get('[data-testid="merge-picker-picked"] button').trigger('click')
    expect(pickedTitles()).toEqual([])
    expect(button('merge-picker-continue').attributes('disabled')).toBeDefined()
  })
})

describe('MergeBooksSheet link alternative', () => {
  it('hands the books to Link when a blocker suggests it', async () => {
    respond(PREVIEW_URL, () => jsonResponse(mergePreview({ eligible: false, previewToken: null, blockers: [{ code: 'FILE_PER_BOOK_LIBRARY' }] })))
    await mountSheet()
    await toReview()

    await button('merge-link-instead').trigger('click')

    expect(wrapper!.emitted('link-instead')).toEqual([
      [
        [1, 2],
        [
          { id: 1, title: 'Book 1', libraryId: 1, formats: ['epub'] },
          { id: 2, title: 'Book 2', libraryId: 1, formats: ['epub'] },
        ],
      ],
    ])
    expect(wrapper!.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('puts the kept book first so Link makes it the main book', async () => {
    respond(PREVIEW_URL, () =>
      jsonResponse(mergePreview({ targetBookId: 2, eligible: false, previewToken: null, blockers: [{ code: 'BOTH_HAVE_AUDIO' }] })),
    )
    await mountSheet({ keeperId: 2 })
    await toReview()

    await button('merge-link-instead').trigger('click')

    const [ids, books] = wrapper!.emitted('link-instead')![0] as [number[], { id: number }[]]
    expect(ids).toEqual([2, 1])
    expect(books.map((book) => book.id)).toEqual([2, 1])
  })
})

describe('MergeBooksSheet review step', () => {
  it('sends the value picked for a field that differs', async () => {
    await mountSheet()
    await toReview()
    respond(MERGE_URL, () => jsonResponse({ jobId: 41 }, 202))

    const options = wrapper!.findAll<HTMLInputElement>('fieldset input[type="radio"]')
    expect(options).toHaveLength(2)
    expect(options.map((option) => option.element.checked)).toEqual([true, false])
    await options[1]!.setValue(true)
    await button('merge-confirm').trigger('click')
    await flushPromises()

    expect(bodies<BookMergeRequest>(MERGE_URL)).toEqual([
      { targetBookId: 1, sourceBookIds: [2], previewToken: 'token-1', fieldOverrides: { publisher: 2 } },
    ])
  })

  it('lists warnings by code', async () => {
    respond(PREVIEW_URL, () =>
      jsonResponse(
        mergePreview({
          warnings: [
            { code: 'KOBO_REDELIVERY', count: 2 },
            { code: 'ISBN_DROPPED', bookId: 2 },
          ],
        }),
      ),
    )
    await mountSheet()
    await toReview()

    const warnings = wrapper!.findAll('[data-testid="merge-warning"]')
    expect(warnings.map((warning) => warning.attributes('data-code'))).toEqual(['KOBO_REDELIVERY', 'ISBN_DROPPED'])
    expect(warnings.every((warning) => warning.text().length > 0)).toBe(true)
  })

  it('offers removing identical copies only with the delete permission', async () => {
    const preview = mergePreview({
      canRemoveIdenticalCopies: true,
      files: [mergePreview().files[0]!, { ...mergePreview().files[1]!, identical: true }],
    })
    respond(PREVIEW_URL, () => jsonResponse(preview))
    await mountSheet()
    await toReview()
    expect(wrapper!.find('[data-testid="merge-remove-identical"]').exists()).toBe(false)
    wrapper!.unmount()

    mocks.permissions = new Set(['library_delete_books'])
    await mountSheet()
    await toReview()
    const checkbox = wrapper!.get<HTMLInputElement>('[data-testid="merge-remove-identical"]')
    expect(checkbox.element.checked).toBe(false)
  })

  it('replaces the confirm button with the reasons when the merge is blocked', async () => {
    respond(PREVIEW_URL, () =>
      jsonResponse(
        mergePreview({
          eligible: false,
          previewToken: null,
          blockers: [
            { code: 'TARGET_NOT_PRESENT', bookId: 1 },
            { code: 'FOLDER_NOT_WRITABLE', relPath: 'Ann Author/Book 1' },
          ],
        }),
      ),
    )
    await mountSheet()
    await toReview()

    const alert = wrapper!.get('[data-testid="merge-blockers"]')
    expect(alert.attributes('role')).toBe('alert')
    expect(alert.findAll('[data-testid="merge-blocker"]').map((item) => item.attributes('data-code'))).toEqual([
      'TARGET_NOT_PRESENT',
      'FOLDER_NOT_WRITABLE',
    ])
    expect(wrapper!.find('[data-testid="merge-confirm"]').exists()).toBe(false)

    await alert.get('button').trigger('click')
    expect(wrapper!.findAll('[data-testid="merge-keeper-card"]')).toHaveLength(2)
  })

  it('disables confirm while the request is in flight and sends it once', async () => {
    await mountSheet()
    await toReview()
    let accept!: (response: Response) => void
    respond(MERGE_URL, () => new Promise<Response>((resolve) => (accept = resolve)))

    await button('merge-confirm').trigger('click')
    expect(button('merge-confirm').attributes('disabled')).toBeDefined()
    await button('merge-confirm').trigger('click')

    accept(jsonResponse({ jobId: 41 }, 202))
    await flushPromises()
    expect(calls(MERGE_URL)).toHaveLength(1)
    expect(wrapper!.find('[role="progressbar"]').exists()).toBe(true)
  })

  it('reloads and explains a preview that went stale before confirm', async () => {
    await mountSheet()
    await toReview()
    respond(MERGE_URL, () => jsonResponse({ errorCode: 'MERGE_PREVIEW_STALE' }, 409))
    respond(PREVIEW_URL, () =>
      jsonResponse(
        mergePreview({ fields: [mergeField('title', { 1: 'Dune', 2: 'Dune' }, 1), mergeField('publisher', { 1: 'Chilton', 2: 'Gollancz' }, 1)] }),
      ),
    )

    await button('merge-confirm').trigger('click')
    await flushPromises()

    expect(wrapper!.get('[data-testid="merge-stale"]').attributes('role')).toBe('status')
    expect(wrapper!.find('[data-testid="merge-execute-error"]').exists()).toBe(true)
    expect(button('merge-confirm').attributes('disabled')).toBeUndefined()
  })
})

describe('MergeBooksSheet result', () => {
  async function runMerge(bookIds: number[]) {
    respond(PREVIEW_URL, () => jsonResponse(mergePreview({ books: bookIds.map((id) => mergeBook(id)) })))
    await mountSheet({ bookIds })
    await toReview()
    respond(MERGE_URL, () => jsonResponse({ jobId: 41 }, 202))
    await button('merge-confirm').trigger('click')
    await flushPromises()
  }

  it('shows each source outcome after a partial merge and reports only the merged books', async () => {
    await runMerge([1, 2, 3])
    const outcomes = [
      { sourceBookId: 2, status: 'merged' as const, errorCode: null },
      { sourceBookId: 3, status: 'failed' as const, errorCode: 'LIBRARY_BUSY' },
    ]
    respond(JOB_URL, () => jsonResponse(mergeJob({ sourceBookIds: [2, 3], status: 'failed', processed: 2, total: 2, outcomes })))

    mocks.finished?.({ jobId: 41, status: 'failed', targetBookId: 1, processed: 2, total: 2, currentSourceBookId: null, outcomes })
    await flushPromises()

    const items = wrapper!.findAll('[data-testid="merge-outcome"]')
    expect(items.map((item) => item.attributes('data-status'))).toEqual(['merged', 'failed'])
    expect(wrapper!.emitted('merged')).toEqual([[{ libraryId: 1, targetBookId: 1, sourceBookIds: [2] }]])
    expect(mocks.toast.warning).toHaveBeenCalledOnce()
    expect(wrapper!.emitted('update:open')).toBeUndefined()
  })

  it('closes with a success notice once every book merged', async () => {
    await runMerge([1, 2])
    respond(JOB_URL, () => jsonResponse(mergeJob()))

    mocks.finished?.({ jobId: 41, status: 'done', targetBookId: 1, processed: 1, total: 1, currentSourceBookId: null, outcomes: [] })
    await flushPromises()

    expect(wrapper!.emitted('merged')).toEqual([[{ libraryId: 1, targetBookId: 1, sourceBookIds: [2] }]])
    expect(mocks.toast.success).toHaveBeenCalledOnce()
    expect(wrapper!.emitted('update:open')).toEqual([[false]])
  })
  it('reopens on the result from the partial notice when the sheet was closed mid-merge', async () => {
    await runMerge([1, 2, 3])
    await wrapper!.setProps({ open: false })
    const outcomes = [
      { sourceBookId: 2, status: 'merged' as const, errorCode: null },
      { sourceBookId: 3, status: 'failed' as const, errorCode: 'LIBRARY_BUSY' },
    ]
    respond(JOB_URL, () => jsonResponse(mergeJob({ sourceBookIds: [2, 3], status: 'failed', processed: 2, total: 2, outcomes })))

    mocks.finished?.({ jobId: 41, status: 'failed', targetBookId: 1, processed: 2, total: 2, currentSourceBookId: null, outcomes })
    await flushPromises()

    const action = mocks.toast.warning.mock.calls[0]?.[1]?.action
    expect(action).toBeDefined()
    action!.onClick()
    expect(wrapper!.emitted('update:open')?.at(-1)).toEqual([true])
    await wrapper!.setProps({ open: true })
    await flushPromises()

    expect(wrapper!.findAll('[data-testid="merge-outcome"]').map((item) => item.attributes('data-status'))).toEqual(['merged', 'failed'])
    expect(calls(PREVIEW_URL)).toHaveLength(1)
  })

  it('starts a fresh review when reopened without the notice', async () => {
    await runMerge([1, 2, 3])
    await wrapper!.setProps({ open: false })
    const outcomes = [
      { sourceBookId: 2, status: 'merged' as const, errorCode: null },
      { sourceBookId: 3, status: 'failed' as const, errorCode: 'LIBRARY_BUSY' },
    ]
    respond(JOB_URL, () => jsonResponse(mergeJob({ sourceBookIds: [2, 3], status: 'failed', processed: 2, total: 2, outcomes })))
    mocks.finished?.({ jobId: 41, status: 'failed', targetBookId: 1, processed: 2, total: 2, currentSourceBookId: null, outcomes })
    await flushPromises()

    await wrapper!.setProps({ open: true })
    await flushPromises()

    expect(wrapper!.find('[data-testid="merge-outcome"]').exists()).toBe(false)
    expect(calls(PREVIEW_URL)).toHaveLength(2)
  })
})
