import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import type { BookDetail } from '@bookorbit/types'
import DetailsTab from '../DetailsTab.vue'
import { useDisplaySettings } from '@/composables/useDisplaySettings'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  push: vi.fn<(to: unknown) => void>(),
  hasPermission: vi.fn<(...args: unknown[]) => boolean>(),
}))

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return {
    ...actual,
    useRouter: () => ({ push: mocks.push, back: vi.fn<() => void>() }),
  }
})

vi.mock('@/lib/api', () => ({
  api: mocks.api,
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: mocks.hasPermission }),
}))

function makeBook(overrides: Partial<BookDetail> = {}): BookDetail {
  return {
    id: 12,
    libraryId: 1,
    libraryName: 'Library',
    status: 'present',
    folderPath: '/books',
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    title: 'Cover Behavior Test',
    subtitle: null,
    description: null,
    isbn10: null,
    isbn13: null,
    publisher: null,
    publishedDate: null,
    publishedYear: null,
    language: null,
    pageCount: null,
    seriesName: null,
    seriesIndex: null,
    rating: null,
    personalNote: null,
    personalNoteUpdatedAt: null,
    communityRatings: [],
    coverSource: 'extracted',
    hardcoverEditionId: null,
    providerIds: {},
    authors: [{ id: 1, name: 'Author One', sortName: null }],
    genres: [],
    tags: [],
    files: [
      {
        id: 101,
        format: 'epub',
        role: 'primary',
        sizeBytes: 1234,
        absolutePath: '/books/cover-behavior-test.epub',
        createdAt: '2026-01-01T00:00:00.000Z',
        filename: 'cover-behavior-test.epub',
        durationSeconds: null,
      },
    ],
    lastWrittenAt: null,
    metadataScore: null,
    readStatus: null,
    audioMetadata: null,
    formatPriority: [],
    comicMetadata: null,
    customMetadata: [],
    lockedFields: [],
    collections: [],
    ...overrides,
  }
}

function response(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as Response
}

const RouterLinkStub = defineComponent({
  name: 'RouterLink',
  props: {
    to: {
      type: [String, Object],
      required: true,
    },
  },
  template: '<a><slot /></a>',
})

let mountedWrappers: Array<{ unmount: () => void }> = []

function mountDetails(book: BookDetail) {
  const wrapper = shallowMount(DetailsTab, {
    props: { book },
    global: {
      stubs: {
        BookCoverArtwork: false,
        BookCoverSurface: false,
        RouterLink: RouterLinkStub,
        Popover: { template: '<div><slot /><slot name="content" /></div>' },
        PopoverTrigger: { template: '<div><slot /></div>' },
        PopoverContent: { template: '<div><slot /></div>' },
        Tooltip: { template: '<div><slot /></div>' },
        TooltipTrigger: { template: '<div><slot /></div>' },
        TooltipContent: { template: '<div><slot /></div>' },
      },
    },
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

async function loadCoverImages(wrapper: ReturnType<typeof mountDetails>, naturalWidth = 1000, naturalHeight = 1000) {
  const imgs = wrapper.findAll(`img[alt="${wrapper.props('book').title}"]`)
  expect(imgs.length).toBe(2)

  for (const img of imgs) {
    Object.defineProperty(img.element, 'naturalWidth', { configurable: true, value: naturalWidth })
    Object.defineProperty(img.element, 'naturalHeight', { configurable: true, value: naturalHeight })
    await img.trigger('load')
  }
}

describe('DetailsTab cover surface', () => {
  const { bookSpineOverlay, bookCoverDisplayMode } = useDisplaySettings()

  beforeEach(() => {
    mocks.api.mockReset()
    mocks.push.mockReset()
    mocks.hasPermission.mockReset()
    mocks.hasPermission.mockReturnValue(true)

    mocks.api.mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/metadata-score/weights')) return response({})
      if (url.includes('/audio-progress')) return response(null)
      if (url.includes('/collections/membership')) return response([])
      if (url.includes('/kobo-state')) {
        return response({
          eligibleForKoboSync: false,
          syncCollections: [],
          readingState: null,
          snapshots: [],
        })
      }
      if (url.includes('/koreader/books/')) return response(null)
      if (url.includes('/progress')) return response([])
      return response({})
    })

    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
  })

  afterEach(() => {
    for (const wrapper of mountedWrappers) wrapper.unmount()
    mountedWrappers = []
    bookSpineOverlay.value = 'off'
    bookCoverDisplayMode.value = 'blurred-fit'
    vi.unstubAllGlobals()
  })

  it('applies configured spine mode and renders fitted spine layer for details covers', async () => {
    bookSpineOverlay.value = 'strong'

    const wrapper = mountDetails(makeBook())
    await flushPromises()

    const surfaces = wrapper.findAll('.book-cover-surface')
    expect(surfaces.length).toBe(2)
    expect(surfaces.every((surface) => surface.attributes('data-cover-spine') === 'strong')).toBe(true)
    expect(wrapper.findAll('.book-cover-spine-layer').length).toBe(0)

    await loadCoverImages(wrapper)

    const spineLayers = wrapper.findAll('.book-cover-spine-layer')
    expect(spineLayers.length).toBe(2)
    expect(spineLayers[0]!.attributes('style')).toContain('translateY(-50%)')
  })

  it('shrinks natural-bottom detail cover surfaces to the loaded cover ratio', async () => {
    bookCoverDisplayMode.value = 'natural-bottom'

    const wrapper = mountDetails(makeBook())
    await flushPromises()
    await loadCoverImages(wrapper, 1200, 600)

    const surfaces = wrapper.findAll('.book-cover-surface')
    expect(surfaces.length).toBe(2)
    expect(surfaces.every((surface) => surface.attributes('style')?.includes('aspect-ratio: 2 / 1'))).toBe(true)
  })

  it('forces spine overlay off for audiobook details covers', async () => {
    bookSpineOverlay.value = 'strong'

    const wrapper = mountDetails(
      makeBook({
        files: [
          {
            id: 102,
            format: 'm4b',
            role: 'primary',
            sizeBytes: 2048,
            absolutePath: '/books/cover-behavior-test.m4b',
            createdAt: '2026-01-01T00:00:00.000Z',
            filename: 'cover-behavior-test.m4b',
            durationSeconds: 3600,
          },
        ],
      }),
    )
    await flushPromises()

    const surfaces = wrapper.findAll('.book-cover-surface')
    expect(surfaces.length).toBe(2)
    expect(surfaces.every((surface) => surface.attributes('data-cover-spine') === 'off')).toBe(true)

    await loadCoverImages(wrapper)

    expect(wrapper.findAll('.book-cover-spine-layer').length).toBe(0)
  })

  it('links authors to their author detail pages', async () => {
    const wrapper = mountDetails(
      makeBook({
        authors: [
          { id: 41, name: 'Author One', sortName: null },
          { id: 42, name: 'Author Two', sortName: null },
        ],
      }),
    )
    await flushPromises()

    const authorLinks = wrapper.findAllComponents(RouterLinkStub).filter((link) => link.text() === 'Author One' || link.text() === 'Author Two')

    expect(authorLinks).toHaveLength(4)
    expect(authorLinks.map((link) => link.props('to'))).toEqual([
      { name: 'author-detail', params: { id: 41 } },
      { name: 'author-detail', params: { id: 42 } },
      { name: 'author-detail', params: { id: 41 } },
      { name: 'author-detail', params: { id: 42 } },
    ])
    expect(wrapper.text()).toContain('Author One, Author Two')
  })

  it('summarizes pending Kobo sync state for each affected device', async () => {
    mocks.api.mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/metadata-score/weights')) return response({})
      if (url.includes('/audio-progress')) return response(null)
      if (url.includes('/collections/membership')) return response([])
      if (url.includes('/kobo-state')) {
        return response({
          eligibleForKoboSync: true,
          syncCollections: ['Favorites'],
          readingState: null,
          snapshots: [
            {
              deviceId: 1,
              deviceName: 'Libra',
              snapshotId: 11,
              snapshotUpdatedAt: '2026-01-01T00:00:00.000Z',
              inSnapshot: true,
              synced: false,
              pendingDelete: true,
              isNew: false,
              removedByDevice: false,
              fileHash: null,
              metadataHash: null,
            },
            {
              deviceId: 2,
              deviceName: 'Elipsa',
              snapshotId: 12,
              snapshotUpdatedAt: '2026-01-01T00:00:00.000Z',
              inSnapshot: true,
              synced: false,
              pendingDelete: true,
              isNew: false,
              removedByDevice: false,
              fileHash: null,
              metadataHash: null,
            },
          ],
        })
      }
      if (url.includes('/koreader/books/')) return response(null)
      if (url.includes('/progress')) return response([])
      return response({})
    })

    const wrapper = mountDetails(makeBook())
    await flushPromises()

    expect(mocks.api).toHaveBeenCalledWith('/api/v1/books/12/kobo-state')
    expect(wrapper.text()).toContain('Pending delete on Libra and Elipsa')
  })

  it('links every series membership to its series detail page', async () => {
    const wrapper = mountDetails(
      makeBook({
        seriesId: 20,
        seriesName: 'Mistborn Era 2',
        seriesIndex: 4,
        seriesMemberships: [
          { seriesId: 22, seriesName: 'Cosmere', seriesIndex: null, displayOrder: 2 },
          { seriesId: 20, seriesName: 'Mistborn Era 2', seriesIndex: 4, displayOrder: 0 },
          { seriesId: 21, seriesName: 'Mistborn Saga', seriesIndex: 7.5, displayOrder: 1 },
        ],
      }),
    )
    await flushPromises()

    const expectedLinks = [
      { text: 'Mistborn Era 2 #4', to: { name: 'series-detail', params: { seriesId: 20 } } },
      { text: 'Mistborn Saga #7.5', to: { name: 'series-detail', params: { seriesId: 21 } } },
      { text: 'Cosmere', to: { name: 'series-detail', params: { seriesId: 22 } } },
    ]
    const seriesLinks = wrapper.findAllComponents(RouterLinkStub).filter((link) => expectedLinks.some((expected) => expected.text === link.text()))

    expect(seriesLinks).toHaveLength(6)
    expect(seriesLinks.map((link) => ({ text: link.text(), to: link.props('to') }))).toEqual([...expectedLinks, ...expectedLinks])
  })

  it('falls back to primary series fields when memberships are absent', async () => {
    const wrapper = mountDetails(
      makeBook({
        seriesId: 20,
        seriesName: 'Mistborn Era 2',
        seriesIndex: 4,
      }),
    )
    await flushPromises()

    const seriesLinks = wrapper.findAllComponents(RouterLinkStub).filter((link) => link.text() === 'Mistborn Era 2 #4')

    expect(seriesLinks).toHaveLength(2)
    expect(seriesLinks.map((link) => link.props('to'))).toEqual([
      { name: 'series-detail', params: { seriesId: 20 } },
      { name: 'series-detail', params: { seriesId: 20 } },
    ])
  })

  it('renders community rating badges with score and tooltip per provider', async () => {
    const wrapper = mountDetails(
      makeBook({
        communityRatings: [
          { provider: 'amazon', rating: 4.8, ratingCount: 104451, updatedAt: '2026-06-25T00:00:00.000Z' },
          { provider: 'hardcover', rating: 4.25, ratingCount: 12345, updatedAt: '2026-06-24T00:00:00.000Z' },
        ],
      }),
    )
    await flushPromises()

    // Scores are visible as text in the badges
    expect(wrapper.text()).toContain('4.8')
    expect(wrapper.text()).toContain('4.3')

    // Full detail is in the title tooltip (not in visible text)
    const titledEls = wrapper.findAll('[title]')
    const tooltips = titledEls.map((el) => el.attributes('title') ?? '')
    expect(tooltips.some((t) => t.includes('4.8 / 5') && t.includes('104,451'))).toBe(true)
    expect(tooltips.some((t) => t.includes('4.3 / 5') && t.includes('12,345'))).toBe(true)
  })

  it('places the sync grid items with the current book id', async () => {
    const wrapper = mountDetails(makeBook())
    await flushPromises()

    const hardcoverItem = wrapper.findComponent({ name: 'HardcoverBookSyncGridItem' })
    expect(hardcoverItem.exists()).toBe(true)
    expect(hardcoverItem.props('bookId')).toBe(12)

    const storygraphItem = wrapper.findComponent({ name: 'StorygraphBookSyncGridItem' })
    expect(storygraphItem.exists()).toBe(true)
    expect(storygraphItem.props('bookId')).toBe(12)
  })

  it('renders a Send via Email action button and opens dialog when user has email_send permission', async () => {
    mocks.hasPermission.mockImplementation((perm) => perm === 'email_send')
    const wrapper = mountDetails(makeBook())
    await flushPromises()

    const sendButtons = wrapper.findAll('button[aria-label="Send via Email"]')
    expect(sendButtons).toHaveLength(2)

    // Find the stubbed SendBookDialog
    const sendDialog = wrapper.findComponent({ name: 'SendBookDialog' })
    expect(sendDialog.exists()).toBe(true)
    expect(sendDialog.props('open')).toBe(false)

    await sendButtons[0]!.trigger('click')
    expect(sendDialog.props('open')).toBe(true)
  })

  it('does not render Send via Email button when user lacks email_send permission', async () => {
    mocks.hasPermission.mockImplementation((perm) => perm !== 'email_send')
    const wrapper = mountDetails(makeBook())
    await flushPromises()

    const sendButtons = wrapper.findAll('button[aria-label="Send via Email"]')
    expect(sendButtons.length).toBe(0)
  })

  it('offers reset in both overflow menus and refreshes supplemental reading state after confirmation', async () => {
    mocks.hasPermission.mockImplementation(
      (permission) => permission === 'library_edit_metadata' || permission === 'kobo_sync' || permission === 'koreader_sync',
    )
    const wrapper = mountDetails(makeBook())
    await flushPromises()

    const resetButtons = wrapper.findAll('button').filter((button) => button.text().includes('Reset reading state'))
    expect(resetButtons).toHaveLength(2)

    const resetDialog = wrapper.findComponent({ name: 'ResetReadingStateDialog' })
    expect(resetDialog.exists()).toBe(true)
    expect(resetDialog.props('open')).toBe(false)

    await resetButtons[0]!.trigger('click')
    expect(resetDialog.props('open')).toBe(true)

    mocks.api.mockClear()
    mocks.api.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/reset-reading-state')) {
        return response({
          readStatus: {
            status: 'unread',
            source: 'manual',
            startedAt: null,
            finishedAt: null,
            updatedAt: '2026-07-09T12:00:00.000Z',
          },
        })
      }
      if (url.includes('/collections/membership')) return response([])
      if (url.includes('/kobo-state')) {
        return response({ eligibleForKoboSync: false, syncCollections: [], readingState: null, snapshots: [] })
      }
      if (url.includes('/koreader/books/')) return response(null)
      if (url.includes('/progress')) return response([])
      return response({})
    })

    resetDialog.vm.$emit('confirm')
    await flushPromises()

    expect(mocks.api).toHaveBeenNthCalledWith(1, '/api/v1/books/12/reset-reading-state', { method: 'POST' })
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/books/12/progress')
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/books/12/kobo-state')
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/koreader/books/12/progress')
    expect(wrapper.emitted('saved')).toEqual([
      [
        expect.objectContaining({
          readStatus: {
            status: 'unread',
            source: 'manual',
            startedAt: null,
            finishedAt: null,
            updatedAt: '2026-07-09T12:00:00.000Z',
          },
        }),
      ],
    ])
  })

  it('hides reset reading state when the user cannot edit metadata', async () => {
    mocks.hasPermission.mockReturnValue(false)
    const wrapper = mountDetails(makeBook())
    await flushPromises()

    expect(wrapper.findAll('button').some((button) => button.text().includes('Reset reading state'))).toBe(false)
  })
})
