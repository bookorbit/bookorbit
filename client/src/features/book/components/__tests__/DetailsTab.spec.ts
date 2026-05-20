import { flushPromises, mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'

beforeEach(() => {
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

describe('DetailsTab — missing state', () => {
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

describe('DetailsTab — present state', () => {
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
          },
        }),
      },
      global: globalStubs,
    })

    expect(wrapper.find('a[title="Open in Amazon"]').exists()).toBe(true)
    expect(wrapper.find('a[title="Open in Goodreads"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Info Links')
  })

  it('renders only collections that already contain the book', async () => {
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

    expect(wrapper.text()).toContain('Favorites')
    expect(wrapper.text()).not.toContain('Want to Read')
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
