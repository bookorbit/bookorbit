import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import type { BookDetail } from '@bookorbit/types'
import DetailsTab from '../DetailsTab.vue'
import { useDisplaySettings } from '@/composables/useDisplaySettings'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  push: vi.fn<(to: unknown) => void>(),
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
  usePermissions: () => ({ hasPermission: () => true }),
}))

function makeBook(overrides: Partial<BookDetail> = {}): BookDetail {
  return {
    id: 12,
    libraryId: 1,
    libraryName: 'Library',
    status: 'present',
    folderPath: '/books',
    addedAt: '2026-01-01T00:00:00.000Z',
    title: 'Cover Behavior Test',
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
    coverSource: 'extracted',
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

function mountDetails(book: BookDetail) {
  return shallowMount(DetailsTab, {
    props: { book },
    global: {
      stubs: {
        BookCoverArtwork: false,
        BookCoverSurface: false,
      },
    },
  })
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

    mocks.api.mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/metadata-score/weights')) return response({})
      if (url.includes('/audio-progress')) return response(null)
      if (url.includes('/collections?')) return response([])
      if (url.includes('/kobo-state')) {
        return response({
          eligibleForKoboSync: false,
          syncCollections: [],
          readingState: null,
          snapshot: null,
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
})
