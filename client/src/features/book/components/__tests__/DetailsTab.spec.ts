import { mount } from '@vue/test-utils'
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
import type { BookDetail } from '@projectx/types'

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
    ...overrides,
  }
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
})
