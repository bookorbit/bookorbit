import { flushPromises, mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
import DetailsTab from '../detail/tabs/DetailsTab.vue'
import type { BookDetail } from '@bookorbit/types'
import { api } from '@/lib/api'

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return {
    ...actual,
    useRouter: () => ({
      push: vi.fn<(...args: unknown[]) => unknown>(),
      replace: vi.fn<(...args: unknown[]) => unknown>(),
    }),
  }
})
vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => false }),
}))
vi.mock('@/lib/api', () => ({
  api: vi.fn<(...args: unknown[]) => Promise<{ ok: boolean; json: () => Promise<Record<string, never>> }>>(async () => ({
    ok: false,
    json: async () => ({}),
  })),
}))
vi.mock('@/features/book/composables/useCoverVersions', () => ({
  useCoverVersions: () => ({ coverUrl: () => '/cover.jpg', bumpVersion: vi.fn<(...args: unknown[]) => void>() }),
}))
vi.mock('@/features/book/lib/book-cover', () => ({
  bookCoverStyle: () => ({ background: 'oklch(0.22 0.07 200)', color: 'oklch(0.92 0.03 200)' }),
  bookCoverPalette: () => ({
    gradient: 'linear-gradient(150deg, oklch(0.22 0.07 200) 0%, oklch(0.28 0.05 220) 100%)',
    from: 'oklch(0.22 0.07 200)',
    to: 'oklch(0.28 0.05 220)',
    color: 'oklch(0.99 0.025 200)',
    accent: 'oklch(0.82 0.16 200)',
    textMuted: 'oklch(0.92 0.08 200)',
  }),
  titleFontSizeClass: () => 'text-[11cqi]',
}))

const globalStubs = {
  stubs: {
    RouterLink: true,
    Tooltip: { template: '<div><slot /></div>' },
    TooltipTrigger: { template: '<div><slot /></div>' },
    TooltipContent: { template: '<div><slot /></div>' },
    DialogRoot: { template: '<div><slot /></div>' },
    DialogPortal: { template: '<div><slot /></div>' },
    DialogOverlay: { template: '<div />' },
    DialogContent: { template: '<div><slot /></div>' },
    DialogClose: { template: '<button><slot /></button>' },
    AddToCollectionSheet: true,
    DeleteBookDialog: true,
  },
}

function makeBook(overrides: Partial<BookDetail> = {}): BookDetail {
  return {
    id: 1,
    libraryId: 1,
    libraryName: 'Test Library',
    addedAt: '2024-01-01T00:00:00.000Z',
    status: 'present',
    title: 'Test Book',
    subtitle: null,
    description: null,
    isbn10: null,
    isbn13: null,
    publisher: null,
    publishedYear: null,
    language: null,
    pageCount: null,
    seriesName: null,
    seriesIndex: null,
    rating: null,
    coverSource: null,
    providerIds: {},
    authors: [],
    genres: [],
    tags: [],
    files: [],
    folderPath: '/books',
    lastWrittenAt: null,
    metadataScore: null,
    readStatus: null,
    audioMetadata: null,
    formatPriority: [],
    comicMetadata: null,
    lockedFields: [],
    collections: [],
    ...overrides,
  }
}

function makeApiResponse(data: unknown, ok = true): Response {
  return {
    ok,
    json: async () => data,
  } as Response
}

describe('DetailsTab - missing state', () => {
  it('renders the amber warning banner', () => {
    const wrapper = mount(DetailsTab, {
      props: { book: makeBook({ status: 'missing' }) },
      global: globalStubs,
    })
    const banner = wrapper.find('[class*="border-amber-500"]')
    expect(banner.exists()).toBe(true)
  })

  it('shows "Files not found" heading in the banner', () => {
    const wrapper = mount(DetailsTab, {
      props: { book: makeBook({ status: 'missing' }) },
      global: globalStubs,
    })
    expect(wrapper.text()).toContain('Files not found')
  })

  it('mentions disk in the banner description', () => {
    const wrapper = mount(DetailsTab, {
      props: { book: makeBook({ status: 'missing' }) },
      global: globalStubs,
    })
    expect(wrapper.text().toLowerCase()).toContain('disk')
  })
})

describe('DetailsTab - present state', () => {
  it('does not render the warning banner', () => {
    const wrapper = mount(DetailsTab, {
      props: { book: makeBook({ status: 'present' }) },
      global: globalStubs,
    })
    expect(wrapper.find('[class*="border-amber-500"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Files not found')
  })

  it('renders provider icon links without the Info Links section', () => {
    const wrapper = mount(DetailsTab, {
      props: {
        book: makeBook({
          providerIds: {
            amazon: '0345415000',
            goodreads: '12345',
            ranobedb: '1287',
          },
        }),
      },
      global: globalStubs,
    })

    expect(wrapper.find('a[title="Open in Amazon"]').exists()).toBe(true)
    expect(wrapper.find('a[title="Open in Goodreads"]').exists()).toBe(true)
    const ranobedbLink = wrapper.find('a[title="Open in RanobeDB"]')
    expect(ranobedbLink.exists()).toBe(true)
    expect(ranobedbLink.attributes('href')).toBe('https://ranobedb.org/book/1287')
    expect(ranobedbLink.find('img[alt="RanobeDB"][src="/assets/provider-icons/ranobedb.svg"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Info Links')
  })

  it('fetches collections data for Kobo sync but does not display them', async () => {
    vi.mocked(api).mockImplementation(async (input) => {
      if (input === '/api/v1/collections?bookIds=1') {
        return makeApiResponse([
          { id: 10, name: 'Favorites', syncToKobo: false, memberCount: 1 },
          { id: 11, name: 'Want to Read', syncToKobo: true, memberCount: 0 },
        ])
      }

      return makeApiResponse({}, false)
    })

    const wrapper = mount(DetailsTab, {
      props: { book: makeBook({ id: 1 }) },
      global: globalStubs,
    })

    await flushPromises()

    expect(vi.mocked(api)).toHaveBeenCalledWith('/api/v1/collections?bookIds=1')
    expect(wrapper.text()).not.toContain('Favorites')
    expect(wrapper.text()).not.toContain('Collections')
  })

  it('shows reading date fields when both dates are null and status is null', () => {
    const wrapper = mount(DetailsTab, {
      props: { book: makeBook({ status: 'present', readStatus: null }) },
      global: globalStubs,
    })

    expect(wrapper.findAll('input[type="date"]')).toHaveLength(0)
    expect(wrapper.text()).toContain('Date Started')
    expect(wrapper.text()).toContain('Date Finished')
    expect(wrapper.text()).toContain('Date Started-')
  })

  it('saves reading date edits with partial update semantics', async () => {
    vi.mocked(api).mockImplementation(async (input, init) => {
      if (input === '/api/v1/books/1/status' && init?.method === 'PATCH') {
        return makeApiResponse({
          status: 'reading',
          source: 'manual',
          startedAt: null,
          finishedAt: '2026-04-10',
          updatedAt: '2026-04-11T00:00:00.000Z',
        })
      }
      if (input === '/api/v1/collections?bookIds=1') return makeApiResponse([])
      return makeApiResponse({}, false)
    })

    const wrapper = mount(DetailsTab, {
      props: {
        book: makeBook({
          readStatus: {
            status: 'reading',
            source: 'manual',
            startedAt: '2026-04-01',
            finishedAt: null,
            updatedAt: '2026-04-02T00:00:00.000Z',
          },
        }),
      },
      global: globalStubs,
    })

    const pencilButton = wrapper.find('button[title="Edit date finished"]')
    expect(pencilButton.exists()).toBe(true)
    await pencilButton.trigger('click')

    const finishedInput = wrapper.find('input[type="date"]')
    await finishedInput.setValue('2026-04-10')

    const saveButton = wrapper.findAll('button').find((button) => button.text() === 'Save')
    expect(saveButton?.exists()).toBe(true)
    await saveButton!.trigger('click')
    await flushPromises()

    expect(vi.mocked(api)).toHaveBeenCalledWith(
      '/api/v1/books/1/status',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ finishedAt: '2026-04-10' }),
      }),
    )
  })

  it('shows validation for finished date earlier than started date and blocks save', async () => {
    vi.mocked(api).mockImplementation(async (input) => {
      if (input === '/api/v1/collections?bookIds=1') return makeApiResponse([])
      return makeApiResponse({}, false)
    })

    const wrapper = mount(DetailsTab, {
      props: {
        book: makeBook({
          readStatus: {
            status: 'reading',
            source: 'manual',
            startedAt: '2026-04-10',
            finishedAt: null,
            updatedAt: '2026-04-11T00:00:00.000Z',
          },
        }),
      },
      global: globalStubs,
    })

    await wrapper.find('button[title="Edit date finished"]').trigger('click')

    const finishedInput = wrapper.find('input[type="date"]')
    await finishedInput.setValue('2026-04-05')
    await flushPromises()

    expect(wrapper.text()).toContain('Date Finished must be on or after Date Started.')
    const saveButton = wrapper.findAll('button').find((button) => button.text() === 'Save')
    expect(saveButton?.exists()).toBe(true)
    await saveButton!.trigger('click')
    await flushPromises()
    expect(vi.mocked(api)).not.toHaveBeenCalledWith('/api/v1/books/1/status', expect.anything())
  })

  it('formats tiny non-zero progress as <1%', async () => {
    vi.mocked(api).mockImplementation(async (input) => {
      if (input === '/api/v1/books/1/progress') {
        return makeApiResponse([{ fileId: 101, cfi: null, pageNumber: null, percentage: 0.4, updatedAt: null }])
      }
      if (input === '/api/v1/collections?bookIds=1') {
        return makeApiResponse([])
      }
      return makeApiResponse({}, false)
    })

    const wrapper = mount(DetailsTab, {
      props: {
        book: makeBook({
          files: [
            {
              id: 101,
              format: 'epub',
              role: 'primary',
              sizeBytes: 1234,
              absolutePath: '/books/test.epub',
              createdAt: '2024-01-01T00:00:00.000Z',
              filename: 'test.epub',
              durationSeconds: null,
            },
          ],
        }),
      },
      global: globalStubs,
    })

    await flushPromises()

    expect(wrapper.text()).toContain('<1%')
  })

  it('formats near-complete progress as >99%', async () => {
    vi.mocked(api).mockImplementation(async (input) => {
      if (input === '/api/v1/books/1/progress') {
        return makeApiResponse([{ fileId: 101, cfi: null, pageNumber: null, percentage: 99.6, updatedAt: null }])
      }
      if (input === '/api/v1/collections?bookIds=1') {
        return makeApiResponse([])
      }
      return makeApiResponse({}, false)
    })

    const wrapper = mount(DetailsTab, {
      props: {
        book: makeBook({
          files: [
            {
              id: 101,
              format: 'epub',
              role: 'primary',
              sizeBytes: 1234,
              absolutePath: '/books/test.epub',
              createdAt: '2024-01-01T00:00:00.000Z',
              filename: 'test.epub',
              durationSeconds: null,
            },
          ],
        }),
      },
      global: globalStubs,
    })

    await flushPromises()

    expect(wrapper.text()).toContain('>99%')
  })

  it('resets a single file progress row from the inline control', async () => {
    let progressRows: Array<{ fileId: number; cfi: string | null; pageNumber: number | null; percentage: number; updatedAt: string | null }> = [
      { fileId: 101, cfi: null, pageNumber: null, percentage: 22, updatedAt: null },
    ]
    vi.mocked(api).mockImplementation(async (input, init) => {
      if (input === '/api/v1/books/files/101/progress' && init?.method === 'DELETE') {
        progressRows = []
        return makeApiResponse({})
      }
      if (input === '/api/v1/books/1/progress') {
        return makeApiResponse(progressRows)
      }
      if (input === '/api/v1/collections?bookIds=1') {
        return makeApiResponse([])
      }
      return makeApiResponse({}, false)
    })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    const wrapper = mount(DetailsTab, {
      props: {
        book: makeBook({
          files: [
            {
              id: 101,
              format: 'epub',
              role: 'primary',
              sizeBytes: 1234,
              absolutePath: '/books/test.epub',
              createdAt: '2024-01-01T00:00:00.000Z',
              filename: 'test.epub',
              durationSeconds: null,
            },
          ],
        }),
      },
      global: globalStubs,
    })

    await flushPromises()

    const fileResetButton = wrapper.find('button[aria-label="Reset file progress"]')
    expect(fileResetButton.exists()).toBe(true)

    await fileResetButton.trigger('click')
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalled()
    expect(vi.mocked(api)).toHaveBeenCalledWith('/api/v1/books/files/101/progress', { method: 'DELETE' })
    confirmSpy.mockRestore()
  })
})

describe('DetailsTab - reading dates compact display', () => {
  it('shows date fields when both dates are null and status is reading', () => {
    const wrapper = mount(DetailsTab, {
      props: {
        book: makeBook({
          readStatus: {
            status: 'reading',
            source: 'manual',
            startedAt: null,
            finishedAt: null,
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        }),
      },
      global: globalStubs,
    })

    expect(wrapper.findAll('input[type="date"]')).toHaveLength(0)
    expect(wrapper.text()).toContain('Date Started')
    expect(wrapper.text()).toContain('Date Finished')
    expect(wrapper.text()).toContain('Date Started-')
  })

  it('shows date fields when status is reading and no dates set', () => {
    const wrapper = mount(DetailsTab, {
      props: {
        book: makeBook({
          readStatus: {
            status: 'reading',
            source: 'manual',
            startedAt: null,
            finishedAt: null,
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        }),
      },
      global: globalStubs,
    })

    expect(wrapper.text()).toContain('Date Started')
    expect(wrapper.text()).toContain('Date Finished')
    expect(wrapper.text()).toContain('Date Started-')
  })

  it('shows date fields when status is read and no dates set', () => {
    const wrapper = mount(DetailsTab, {
      props: {
        book: makeBook({
          readStatus: {
            status: 'read',
            source: 'manual',
            startedAt: null,
            finishedAt: null,
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        }),
      },
      global: globalStubs,
    })

    expect(wrapper.text()).toContain('Date Started')
    expect(wrapper.text()).toContain('Date Finished')
    expect(wrapper.text()).toContain('Date Started-')
  })

  it('shows reading date fields when status is unread and no dates set', () => {
    const wrapper = mount(DetailsTab, {
      props: {
        book: makeBook({
          readStatus: {
            status: 'unread',
            source: 'manual',
            startedAt: null,
            finishedAt: null,
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        }),
      },
      global: globalStubs,
    })

    expect(wrapper.text()).toContain('Date Started')
    expect(wrapper.text()).toContain('Date Finished')
    expect(wrapper.text()).toContain('Date Started-')
  })

  it('shows reading date fields when readStatus is null', () => {
    const wrapper = mount(DetailsTab, {
      props: { book: makeBook({ readStatus: null }) },
      global: globalStubs,
    })

    expect(wrapper.text()).toContain('Date Started')
    expect(wrapper.text()).toContain('Date Finished')
    expect(wrapper.text()).toContain('Date Started-')
  })

  it('shows compact dates when startedAt is set', () => {
    const wrapper = mount(DetailsTab, {
      props: {
        book: makeBook({
          readStatus: {
            status: 'reading',
            source: 'manual',
            startedAt: '2026-04-01',
            finishedAt: null,
            updatedAt: '2026-04-02T00:00:00.000Z',
          },
        }),
      },
      global: globalStubs,
    })

    expect(wrapper.text()).toContain('Date Started')
    expect(wrapper.text()).toContain('Apr 1, 2026')
    expect(wrapper.findAll('input[type="date"]')).toHaveLength(0)
  })

  it('shows compact dates when finishedAt is set', () => {
    const wrapper = mount(DetailsTab, {
      props: {
        book: makeBook({
          readStatus: {
            status: 'read',
            source: 'manual',
            startedAt: null,
            finishedAt: '2026-05-20',
            updatedAt: '2026-05-21T00:00:00.000Z',
          },
        }),
      },
      global: globalStubs,
    })

    expect(wrapper.text()).toContain('Date Finished')
    expect(wrapper.text()).toContain('May 20, 2026')
    expect(wrapper.findAll('input[type="date"]')).toHaveLength(0)
  })

  it('shows both compact dates when both dates are set', () => {
    const wrapper = mount(DetailsTab, {
      props: {
        book: makeBook({
          readStatus: {
            status: 'read',
            source: 'manual',
            startedAt: '2026-04-01',
            finishedAt: '2026-05-20',
            updatedAt: '2026-05-21T00:00:00.000Z',
          },
        }),
      },
      global: globalStubs,
    })

    expect(wrapper.text()).toContain('Apr 1, 2026')
    expect(wrapper.text()).toContain('May 20, 2026')
  })

  it('shows em dash for missing date in compact view', () => {
    const wrapper = mount(DetailsTab, {
      props: {
        book: makeBook({
          readStatus: {
            status: 'reading',
            source: 'manual',
            startedAt: '2026-04-01',
            finishedAt: null,
            updatedAt: '2026-04-02T00:00:00.000Z',
          },
        }),
      },
      global: globalStubs,
    })

    expect(wrapper.text()).toContain('Date Finished-')
  })

  it('clicking Date Started edit enters edit mode and shows one date input', async () => {
    const wrapper = mount(DetailsTab, {
      props: {
        book: makeBook({
          readStatus: {
            status: 'reading',
            source: 'manual',
            startedAt: '2026-04-01',
            finishedAt: null,
            updatedAt: '2026-04-02T00:00:00.000Z',
          },
        }),
      },
      global: globalStubs,
    })

    expect(wrapper.findAll('input[type="date"]')).toHaveLength(0)

    const pencilButton = wrapper.find('button[title="Edit date started"]')
    expect(pencilButton.exists()).toBe(true)
    await pencilButton.trigger('click')

    expect(wrapper.findAll('input[type="date"]')).toHaveLength(1)
  })

  it('cancel closes Date Started edit mode and hides date input', async () => {
    const wrapper = mount(DetailsTab, {
      props: {
        book: makeBook({
          readStatus: {
            status: 'read',
            source: 'manual',
            startedAt: '2026-04-01',
            finishedAt: '2026-05-01',
            updatedAt: '2026-05-02T00:00:00.000Z',
          },
        }),
      },
      global: globalStubs,
    })

    await wrapper.find('button[title="Edit date started"]').trigger('click')
    expect(wrapper.findAll('input[type="date"]')).toHaveLength(1)

    const cancelButton = wrapper.find('button[title="Cancel date started edit"]')
    expect(cancelButton.exists()).toBe(true)
    await cancelButton.trigger('click')

    expect(wrapper.findAll('input[type="date"]')).toHaveLength(0)
    expect(wrapper.text()).toContain('Apr 1, 2026')
  })

  it('save on Date Finished closes edit mode on success and shows updated value', async () => {
    vi.mocked(api).mockImplementation(async (input, init) => {
      if (input === '/api/v1/books/1/status' && init?.method === 'PATCH') {
        return makeApiResponse({
          status: 'read',
          source: 'manual',
          startedAt: '2026-04-01',
          finishedAt: '2026-05-20',
          updatedAt: '2026-05-21T00:00:00.000Z',
        })
      }
      if (input === '/api/v1/collections?bookIds=1') return makeApiResponse([])
      return makeApiResponse({}, false)
    })

    const wrapper = mount(DetailsTab, {
      props: {
        book: makeBook({
          readStatus: {
            status: 'reading',
            source: 'manual',
            startedAt: '2026-04-01',
            finishedAt: null,
            updatedAt: '2026-04-02T00:00:00.000Z',
          },
        }),
      },
      global: globalStubs,
    })

    await wrapper.find('button[title="Edit date finished"]').trigger('click')

    const finishedInput = wrapper.find('input[type="date"]')
    await finishedInput.setValue('2026-05-20')

    const saveButton = wrapper.findAll('button').find((b) => b.text() === 'Save')
    await saveButton!.trigger('click')
    await flushPromises()

    expect(wrapper.findAll('input[type="date"]')).toHaveLength(0)
    expect(wrapper.text()).toContain('May 20, 2026')
  })

  it('clicking Date Started edit opens edit mode when no dates are set', async () => {
    const wrapper = mount(DetailsTab, {
      props: {
        book: makeBook({
          readStatus: {
            status: 'reading',
            source: 'manual',
            startedAt: null,
            finishedAt: null,
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        }),
      },
      global: globalStubs,
    })

    const editStartedButton = wrapper.find('button[title="Edit date started"]')
    expect(editStartedButton.exists()).toBe(true)
    await editStartedButton.trigger('click')

    expect(wrapper.findAll('input[type="date"]')).toHaveLength(1)
  })
})
