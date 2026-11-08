import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import type { BookCard, BookMergeJobEvent, BookMergePreviewRequest, BookMergePreviewResponse, BookMergeRequest, Library } from '@bookorbit/types'
import { i18n } from '@/i18n'
import MergeBooksSheet from '../MergeBooksSheet.vue'
import { jsonResponse, mergeBook, mergeFile, mergeJob, mergePreview } from './fixtures'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  progress: null as ((event: BookMergeJobEvent) => void) | null,
  finished: null as ((event: BookMergeJobEvent) => void) | null,
  push: vi.fn<(location: unknown) => Promise<void>>(),
  toast: {
    success: vi.fn<(message: string, options?: { action?: { label: string; onClick: () => void } }) => void>(),
    warning: vi.fn<(message: string) => void>(),
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
    onBookMergeProgress: (callback: (event: BookMergeJobEvent) => void) => {
      mocks.progress = callback
      return () => undefined
    },
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
const SEARCH_URL = '/api/v1/books/query'
const JOB_URL = '/api/v1/books/merge/jobs/41'

let routes: Map<string, Handler[]>
let wrapper: VueWrapper | null = null

function respond(url: string, ...handlers: Handler[]): void {
  routes.set(url, handlers)
}

function bodies<T>(url: string): T[] {
  return mocks.api.mock.calls.filter(([input]) => String(input) === url).map(([, init]) => JSON.parse(String(init?.body)) as T)
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

/** Frankenstein as an ebook in Books (kept) and an audiobook in Audiobooks; two readers of Books cannot open Audiobooks. */
function crossPreview(overrides: Partial<BookMergePreviewResponse> = {}): BookMergePreviewResponse {
  return mergePreview({
    books: [
      mergeBook(1, { title: 'Frankenstein', libraryId: 1, libraryName: 'Books', formats: ['epub', 'pdf'], libraryFolderId: 11 }),
      mergeBook(2, { title: 'Frankenstein (audio)', libraryId: 2, libraryName: 'Audiobooks', formats: ['m4b'], hasAudio: true, libraryFolderId: 12 }),
    ],
    destinationBookId: 1,
    destinationLibraryId: 1,
    destinationCandidates: [1, 2],
    destinationAccessLoss: [
      { bookId: 1, libraryId: 1, losesAccess: false, count: 0 },
      { bookId: 2, libraryId: 2, losesAccess: true, count: 2 },
    ],
    files: [
      mergeFile(10, 1, {
        action: 'stay',
        reason: 'already_in_destination',
        fromRelPath: 'Ann Author/Book 1/book-10.epub',
        toRelPath: 'Ann Author/Book 1/book-10.epub',
        fromLibraryId: 1,
        toLibraryId: 1,
      }),
      mergeFile(20, 2, { format: 'm4b', sizeBytes: 4_300_000, fromLibraryId: 2, toLibraryId: 1 }),
      mergeFile(21, 2, {
        format: null,
        role: 'metadata',
        action: 'stay',
        reason: 'metadata_kept_in_place',
        fromRelPath: 'Ann Author/Book 2/metadata.opf',
        toRelPath: 'Ann Author/Book 2/metadata.opf',
        fromLibraryId: 2,
        toLibraryId: 2,
      }),
    ],
    ...overrides,
  })
}

async function mountSheet(props: Record<string, unknown> = {}) {
  wrapper = mount(MergeBooksSheet, { props: { open: true, bookIds: [1, 2], keeperId: 1, ...props }, global: { stubs } })
  await flushPromises()
  return wrapper
}

function byTestId(testId: string) {
  return wrapper!.get(`[data-testid="${testId}"]`)
}

async function toReview() {
  await byTestId('merge-continue').trigger('click')
  await flushPromises()
}

beforeEach(() => {
  i18n.global.locale.value = 'en'
  routes = new Map()
  mocks.api.mockReset()
  mocks.api.mockImplementation(async (input) => {
    const queue = routes.get(String(input))
    const handler = queue && queue.length > 1 ? queue.shift() : queue?.[0]
    if (!handler) throw new Error(`Unexpected request ${String(input)}`)
    return handler()
  })
  mocks.push.mockReset()
  for (const fn of Object.values(mocks.toast)) fn.mockReset()
  mocks.permissions = new Set(['library_merge_books'])
  mocks.progress = null
  mocks.finished = null
  libraries.value = [
    { id: 1, name: 'Books', accessLevel: 'editor' },
    { id: 2, name: 'Audiobooks', accessLevel: 'editor' },
    { id: 3, name: 'Comics', accessLevel: 'viewer' },
    { id: 4, name: 'Archive', accessLevel: 'owner' },
  ] as Library[]
  respond(PREVIEW_URL, () => jsonResponse(crossPreview()))
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.useRealTimers()
})

describe('merge picker across libraries', () => {
  function card(id: number, libraryId: number): BookCard {
    return { id, libraryId, title: `Book ${id}`, authors: [], files: [], hasCover: false, coverVersion: '1' } as unknown as BookCard
  }

  it('searches every library the user can merge in, the open book’s library first, each under its name', async () => {
    vi.useFakeTimers()
    respond(SEARCH_URL, () => jsonResponse({ items: [card(5, 1), card(6, 2), card(7, 3), card(8, 4)], total: 4, page: 0, size: 20 }))
    wrapper = mount(MergeBooksSheet, { props: { open: true, bookIds: [1], keeperId: 1, pickerLibraryId: 2 }, global: { stubs } })
    await flushPromises()

    await wrapper.get('input[type="search"]').setValue('Book')
    await vi.runAllTimersAsync()
    await flushPromises()

    expect(mocks.api.mock.calls.some(([input]) => String(input) === SEARCH_URL)).toBe(true)
    const groups = wrapper.findAll('[data-testid="merge-picker-group"]')
    const headings = groups.map((group) => group.get('h4'))
    expect(headings.map((heading) => heading.text())).toEqual(['Audiobooks', 'Books', 'Archive'])
    expect(headings.every((heading) => heading.attributes('dir') === 'auto')).toBe(true)
    expect(groups[0]!.attributes('aria-labelledby')).toBe(headings[0]!.attributes('id'))
    // Comics is only viewed, so its book is never offered.
    expect(wrapper.text()).not.toContain('Book 7')
    expect(groups[1]!.text()).toContain('In Books')
  })
})

describe('where the merged book lives', () => {
  function options() {
    return wrapper!.findAll('[data-testid="merge-library-option"]')
  }

  it('offers each place as a native radio with the library that stops showing the book and who loses access', async () => {
    await mountSheet()

    const group = byTestId('merge-library-destination').get('fieldset')
    expect(group.get('legend').text()).toBe('Where the merged book lives')
    const radios = group.findAll<HTMLInputElement>('input[type="radio"]')
    expect(radios.map((radio) => radio.element.checked)).toEqual([true, false])

    const [books, audiobooks] = options()
    expect(books!.text()).toContain('Books')
    expect(books!.text()).toContain('EPUB, PDF here now')
    expect(books!.get('[data-testid="merge-library-consequence"]').text()).toBe('Audiobooks stops showing this book')
    expect(books!.find('[data-testid="merge-library-access"]').exists()).toBe(false)
    expect(audiobooks!.get('[data-testid="merge-library-consequence"]').text()).toBe('Books stops showing this book')
    expect(audiobooks!.get('[data-testid="merge-library-access"]').text()).toBe('2 readers of Books cannot open Audiobooks')
    expect(audiobooks!.get('span[dir="auto"]').text()).toBe('Audiobooks')
  })

  it('says some readers when the count is not the viewer’s to see', async () => {
    respond(PREVIEW_URL, () =>
      jsonResponse(
        crossPreview({
          destinationAccessLoss: [
            { bookId: 1, libraryId: 1, losesAccess: false, count: null },
            { bookId: 2, libraryId: 2, losesAccess: true, count: null },
          ],
        }),
      ),
    )
    await mountSheet()

    expect(options()[1]!.get('[data-testid="merge-library-access"]').text()).toBe('Some readers cannot open Audiobooks')
  })

  it('asks for a new preview with the chosen place', async () => {
    vi.useFakeTimers()
    await mountSheet()
    respond(PREVIEW_URL, () => jsonResponse(crossPreview({ destinationBookId: 2, destinationLibraryId: 2 })))

    await options()[1]!.get('input[type="radio"]').setValue(true)
    await vi.runAllTimersAsync()
    await flushPromises()

    expect(bodies<BookMergePreviewRequest>(PREVIEW_URL).at(-1)).toEqual({ targetBookId: 1, sourceBookIds: [2], destinationBookId: 2 })
    expect(options()[1]!.get<HTMLInputElement>('input[type="radio"]').element.checked).toBe(true)
  })

  it('states a single place instead of offering a lone radio', async () => {
    respond(PREVIEW_URL, () => jsonResponse(crossPreview({ destinationCandidates: [1] })))
    await mountSheet()

    const section = byTestId('merge-library-destination')
    expect(section.find('fieldset').exists()).toBe(false)
    expect(section.find('input[type="radio"]').exists()).toBe(false)
    expect(section.get('h4').text()).toBe('Where the merged book lives')
    expect(section.get('[data-testid="merge-library-consequence"]').text()).toBe('Audiobooks stops showing this book')
  })

  it('keeps the plain folder chooser when every book is in one library', async () => {
    respond(PREVIEW_URL, () => jsonResponse(mergePreview()))
    await mountSheet()

    expect(wrapper!.find('[data-testid="merge-library-destination"]').exists()).toBe(false)
    expect(wrapper!.find('[data-testid="merge-destination-summary"]').exists()).toBe(true)
  })
})

describe('cross-library review', () => {
  it('names the destination library in bold in the header', async () => {
    await mountSheet()
    await toReview()

    const header = byTestId('merge-review-header')
    expect(header.text()).toBe('Merge 2 books into Frankenstein in Books')
    expect(header.get('strong').text()).toBe('Books')
    expect(header.get('strong').attributes('dir')).toBe('auto')
  })

  it('groups the files by direction and lists what stays behind untracked', async () => {
    await mountSheet()
    await toReview()

    const groups = wrapper!.findAll('[data-testid="merge-file-group"]')
    expect(groups.map((group) => group.get('h5').text())).toEqual([
      'From Audiobooks to Books (1 file, 4.1 MB)',
      expect.stringMatching(/^Within Books \(1 file, /),
    ])
    expect(wrapper!.findAll('[data-testid="merge-file"]')).toHaveLength(2)

    const left = byTestId('merge-left-behind')
    expect(left.text()).toContain('Left in Audiobooks')
    expect(left.text()).toContain('BookOrbit stops tracking them')
    expect(left.text()).toContain('Ann Author/Book 2/metadata.opf')
  })

  it('keeps the flat file list for a server that does not say which library each file is in', async () => {
    const preview = crossPreview()
    respond(PREVIEW_URL, () => jsonResponse({ ...preview, files: preview.files.map(({ fromLibraryId: _from, toLibraryId: _to, ...file }) => file) }))
    await mountSheet()
    await toReview()

    expect(wrapper!.find('[data-testid="merge-file-group"]').exists()).toBe(false)
    expect(wrapper!.find('[data-testid="merge-left-behind"]').exists()).toBe(false)
    expect(wrapper!.findAll('[data-testid="merge-file"]')).toHaveLength(3)
  })

  it('says which devices lose the book and which library settings change', async () => {
    respond(PREVIEW_URL, () =>
      jsonResponse(
        crossPreview({
          warnings: [
            { code: 'KOBO_REMOVAL', count: 1 },
            { code: 'CUSTOM_FIELDS_HIDDEN', count: 2, libraryId: 1 },
            { code: 'TARGET_CHANGES_LIBRARY', libraryId: 1 },
          ],
          librarySettingChanges: [
            { setting: 'primaryFormat', fromLibraryId: 2, toLibraryId: 1, format: 'epub' },
            { setting: 'fileWrite', fromLibraryId: 2, toLibraryId: 1 },
            { setting: 'namingPattern', fromLibraryId: 2, toLibraryId: 1 },
            { setting: 'readThreshold' as never, fromLibraryId: 2, toLibraryId: 1 },
          ],
        }),
      ),
    )
    await mountSheet()
    await toReview()

    expect(byTestId('merge-devices').text()).toContain('This book leaves the Kobo of 1 reader on their next sync.')
    expect(
      byTestId('merge-library-settings')
        .findAll('li')
        .map((line) => line.text()),
    ).toEqual([
      'Books puts EPUB first, so the main file becomes the EPUB',
      'Books writes metadata into files',
      'File names stay as they are. Bulk Rename can apply the naming pattern of Books.',
      'Books does not use 2 custom fields of this book. Their values are kept but hidden.',
    ])
    const listed = wrapper!.findAll('[data-testid="merge-warning"]').map((warning) => warning.attributes('data-code'))
    expect(listed).toEqual(['TARGET_CHANGES_LIBRARY'])
    expect(wrapper!.get('[data-code="TARGET_CHANGES_LIBRARY"]').text()).toContain('The kept book moves to Books.')
  })

  it('keeps Confirm off until the reviewer acknowledges the readers who lose access, then sends it', async () => {
    respond(PREVIEW_URL, () => jsonResponse(crossPreview({ warnings: [{ code: 'LIBRARY_ACCESS_NARROWS', libraryId: 1, count: 2 }] })))
    await mountSheet()
    await toReview()
    respond(MERGE_URL, () => jsonResponse({ jobId: 41 }, 202))

    const callout = byTestId('merge-access-callout')
    expect(callout.text()).toContain('2 readers cannot open Books')
    const checkbox = callout.get<HTMLInputElement>('input[type="checkbox"]')
    const label = checkbox.element.closest('label')!
    expect(label.textContent).toContain('I understand 2 readers lose access to this book and its reading data until they get access to Books')
    expect(checkbox.attributes('aria-describedby')).toBe(callout.get('p').attributes('id'))
    expect(byTestId('merge-confirm').attributes('disabled')).toBeDefined()

    await checkbox.setValue(true)
    expect(byTestId('merge-confirm').attributes('disabled')).toBeUndefined()
    await byTestId('merge-confirm').trigger('click')
    await flushPromises()

    expect(bodies<BookMergeRequest>(MERGE_URL)).toEqual([
      { targetBookId: 1, sourceBookIds: [2], previewToken: 'token-1', acknowledgeAccessLoss: true },
    ])
  })

  it('never sends the acknowledgement when the preview did not ask for it', async () => {
    await mountSheet()
    await toReview()
    respond(MERGE_URL, () => jsonResponse({ jobId: 41 }, 202))

    expect(wrapper!.find('[data-testid="merge-access-callout"]').exists()).toBe(false)
    await byTestId('merge-confirm').trigger('click')
    await flushPromises()

    expect(bodies<BookMergeRequest>(MERGE_URL)[0]).not.toHaveProperty('acknowledgeAccessLoss')
  })
})

describe('cross-library blockers', () => {
  it('points at another place for the merged book when one avoids the blocker, beside Link', async () => {
    respond(PREVIEW_URL, () =>
      jsonResponse(
        crossPreview({
          eligible: false,
          previewToken: null,
          destinationBookId: 2,
          destinationLibraryId: 2,
          blockers: [{ code: 'READERS_LOSE_ACCESS' }],
        }),
      ),
    )
    await mountSheet()
    await toReview()

    const blocker = wrapper!.get('[data-code="READERS_LOSE_ACCESS"]')
    expect(blocker.find('[data-testid="merge-link-instead"]').exists()).toBe(true)
    await blocker.get('[data-testid="merge-choose-destination"]').trigger('click')
    await flushPromises()

    expect(wrapper!.find('[data-testid="merge-library-destination"]').exists()).toBe(true)
  })

  it('offers only Link when no other place avoids the blocker', async () => {
    respond(PREVIEW_URL, () =>
      jsonResponse(
        crossPreview({
          eligible: false,
          previewToken: null,
          blockers: [{ code: 'LEFTOVER_CONTENT', libraryId: 2, relPath: 'Ann Author/Book 2/x.pdf' }],
        }),
      ),
    )
    await mountSheet()
    await toReview()

    const blocker = wrapper!.get('[data-code="LEFTOVER_CONTENT"]')
    expect(blocker.find('[data-testid="merge-choose-destination"]').exists()).toBe(false)
    expect(blocker.find('[data-testid="merge-link-instead"]').exists()).toBe(true)
  })
})

describe('cross-library progress', () => {
  async function runMerge() {
    await mountSheet()
    await toReview()
    respond(MERGE_URL, () => jsonResponse({ jobId: 41 }, 202))
    await byTestId('merge-confirm').trigger('click')
    await flushPromises()
  }

  it('counts the copy in bytes when the server reports them', async () => {
    await runMerge()
    expect(wrapper!.find('[data-testid="merge-bytes-progress"]').exists()).toBe(false)

    const total = Math.round(1.2 * 1024 ** 3)
    const done = 640 * 1024 ** 2
    mocks.progress?.({
      jobId: 41,
      status: 'moving',
      targetBookId: 1,
      processed: 0,
      total: 1,
      currentSourceBookId: 2,
      outcomes: [],
      bytesTotal: total,
      bytesDone: done,
    })
    await flushPromises()

    const bar = byTestId('merge-bytes-progress')
    expect(bar.attributes('role')).toBe('progressbar')
    expect(bar.attributes('aria-valuenow')).toBe(String(done))
    expect(bar.attributes('aria-valuemax')).toBe(String(total))
    expect(byTestId('merge-bytes-text').text()).toBe('Copying 640 MB of 1.2 GB')
  })

  it('names the library in the completion notice and offers to open the book', async () => {
    await runMerge()
    respond(JOB_URL, () => jsonResponse(mergeJob()))

    mocks.finished?.({ jobId: 41, status: 'done', targetBookId: 1, processed: 1, total: 1, currentSourceBookId: null, outcomes: [] })
    await flushPromises()

    const [message, options] = mocks.toast.success.mock.calls[0]!
    expect(message).toBe('Merged into Frankenstein in Books')
    expect(options?.action?.label).toBe('Open book')
    options!.action!.onClick()
    expect(mocks.push).toHaveBeenCalledWith({ name: 'book-detail', params: { bookId: 1 } })
    expect(wrapper!.emitted('merged')).toEqual([[{ libraryId: 1, targetBookId: 1, sourceBookIds: [2], sourceLibraryIds: [1, 2] }]])
  })
})
