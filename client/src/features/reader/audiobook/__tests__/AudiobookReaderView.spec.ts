import { ref } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AudiobookManifest, BookDetail } from '@bookorbit/types'
import type { useCoverVersions } from '@/features/book/composables/useCoverVersions'

import AudiobookReaderView from '../AudiobookReaderView.vue'
import BookCoverPlaceholder from '@/features/book/components/BookCoverPlaceholder.vue'
import CoverFill from '@/features/book/components/CoverFill.vue'

type CoverUrl = ReturnType<typeof useCoverVersions>['coverUrl']

const BOOK_ID = 7
const FILE_ID = 71
const COVER_VERSION = 'ebook:2026-09-20T10:00:00.000Z:2026-09-21T12:30:00.000Z'
const ARTWORK_URL = 'blob:audio-artwork'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(input: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>(),
  coverUrl: vi.fn<CoverUrl>(),
  createCoverFillArtworkUrl: vi.fn<(src: string, size?: number) => Promise<string | null>>(),
  revokeObjectURL: vi.fn<(url: string) => void>(),
}))
let activeQueueLoadError: ReturnType<typeof ref<string | null>> | null = null

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { bookId: '7', fileId: '71' }, query: {} }),
  useRouter: () => ({ back: vi.fn<() => void>(), replace: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) }),
}))

vi.mock('@/lib/api', () => ({ api: mocks.api }))

vi.mock('@/features/book/composables/useCoverVersions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/book/composables/useCoverVersions')>()
  return {
    useCoverVersions: () => {
      const real = actual.useCoverVersions()
      mocks.coverUrl.mockImplementation(real.coverUrl)
      return { ...real, coverUrl: mocks.coverUrl }
    },
  }
})

vi.mock('@/features/book/lib/cover-fill-artwork', () => ({ createCoverFillArtworkUrl: mocks.createCoverFillArtworkUrl }))

vi.mock('../composables/useAudioProgress', () => ({
  useAudioProgress: () => ({
    resumeAssetId: ref<string | null>(null),
    resumePosition: ref(0),
    revision: ref(0),
    loaded: ref(true),
    load: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    update: vi.fn<(assetId: string, positionSeconds: number) => void>(),
    flush: vi.fn<() => void>(),
  }),
}))

vi.mock('../composables/useAudioQueue', () => ({
  useAudioQueue: () => ({
    currentIndex: ref(0),
    isPlaying: ref(false),
    loadError: (activeQueueLoadError = ref<string | null>(null)),
    activateIndex: vi.fn<(index: number, positionSeconds: number) => void>(),
    play: vi.fn<() => void>(),
    pause: vi.fn<() => void>(),
    seek: vi.fn<(positionSeconds: number) => void>(),
    position: vi.fn<() => number>().mockReturnValue(0),
    setSpeed: vi.fn<(rate: number) => void>(),
    setVolume: vi.fn<(volume: number) => void>(),
    goToAsset: vi.fn<(assetId: string, positionSeconds: number) => void>(),
    nextFile: vi.fn<() => void>(),
    prevFile: vi.fn<() => void>(),
    destroy: vi.fn<() => void>(),
  }),
}))

vi.mock('../composables/useAudioSettings', () => ({
  useAudioSettings: () => ({
    playbackSpeed: ref(1),
    volume: ref(1),
    skipBackSeconds: ref(15),
    skipForwardSeconds: ref(30),
    init: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    setPlaybackSpeed: vi.fn<(rate: number) => void>(),
    setVolume: vi.fn<(volume: number) => void>(),
    setSkipBackSeconds: vi.fn<(seconds: number) => void>(),
    setSkipForwardSeconds: vi.fn<(seconds: number) => void>(),
  }),
}))

vi.mock('../composables/useAudioBookmarks', () => ({
  useAudioBookmarks: () => ({
    bookmarks: ref([]),
    load: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    add: vi.fn<(positionSeconds: number, title: string, chapterId?: string) => Promise<null>>().mockResolvedValue(null),
    remove: vi.fn<(bookmarkId: string) => Promise<void>>().mockResolvedValue(undefined),
  }),
}))

vi.mock('../../shared/composables/useReadingSession', () => ({
  useReadingSession: () => ({ onActivity: vi.fn<() => void>() }),
}))

vi.mock('../../shared/composables/useFullscreen', () => ({
  useFullscreen: () => ({ isFullscreen: ref(false), toggleFullscreen: vi.fn<() => void>() }),
}))

function bookDetail(overrides: Partial<BookDetail> = {}): BookDetail {
  return {
    id: BOOK_ID,
    libraryId: 1,
    libraryName: 'Library',
    status: 'present',
    folderPath: '/path/to/library/The Long Orbit',
    addedAt: '2026-09-01T00:00:00.000Z',
    updatedAt: null,
    title: 'The Long Orbit',
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
    coverMedia: ['ebook', 'audio'],
    covers: {
      ebook: { source: 'extracted', updatedAt: '2026-09-20T10:00:00.000Z', width: 600, height: 900 },
      audio: { source: 'custom', updatedAt: '2026-09-21T12:30:00.000Z', width: 1000, height: 1000 },
    },
    coverVersion: COVER_VERSION,
    hardcoverEditionId: null,
    providerIds: {},
    authors: [{ id: 1, name: 'Ada Vance', sortName: 'Vance, Ada' }],
    genres: [],
    tags: [],
    files: [
      {
        id: 70,
        role: 'primary',
        format: 'epub',
        filename: 'the-long-orbit.epub',
        sizeBytes: 1024,
        absolutePath: '/path/to/library/The Long Orbit/the-long-orbit.epub',
        createdAt: '2026-09-01T00:00:00.000Z',
        durationSeconds: null,
      },
      {
        id: FILE_ID,
        role: 'content',
        format: 'm4b',
        filename: 'the-long-orbit.m4b',
        sizeBytes: 4096,
        absolutePath: '/path/to/library/The Long Orbit/the-long-orbit.m4b',
        createdAt: '2026-09-01T00:00:00.000Z',
        durationSeconds: 3600,
      },
    ],
    lastWrittenAt: null,
    metadataScore: null,
    readStatus: null,
    audioMetadata: null,
    readAloudSync: {
      mode: 'auto',
      state: 'unavailable',
      unavailableReason: 'no_media_overlay_epub',
      overlayFileId: null,
      audioDurationSeconds: null,
      overlayDurationSeconds: null,
      durationDifferenceSeconds: null,
      durationDifferenceRatio: null,
      koreaderDownloadAvailable: false,
    },
    formatPriority: [],
    comicMetadata: null,
    customMetadata: [],
    lockedFields: [],
    collections: [],
    ...overrides,
  }
}

function audiobookManifest(): AudiobookManifest {
  return {
    schema: 'bookorbit.audiobook-manifest',
    schemaVersion: 2,
    revision: 'manifest-rev-1',
    book: { id: BOOK_ID, title: 'The Long Orbit', authors: ['Ada Vance'], narrators: ['Sam Reed'], hasCover: true },
    assets: [{ assetId: 'asset-1', sequence: 0, format: 'm4b', durationMs: 3_600_000, sizeBytes: 4096, etag: 'etag-1' }],
    chapters: [{ id: 'chapter-1', title: 'Launch', assetId: 'asset-1', sequence: 0, startMs: 0, endMs: 3_600_000, assetOffsetMs: 0 }],
    totalDurationMs: 3_600_000,
  }
}

function serve(detail: BookDetail) {
  mocks.api.mockImplementation(async (input) => {
    if (input === `/api/v1/books/${BOOK_ID}`) return { ok: true, json: async () => detail }
    if (input === `/api/v1/audiobooks/${BOOK_ID}/manifest`) return { ok: true, json: async () => audiobookManifest() }
    throw new Error(`Unexpected request: ${input}`)
  })
}

function stubMediaSession() {
  const session: { metadata: MediaMetadataInit | null; playbackState: MediaSessionPlaybackState } = { metadata: null, playbackState: 'none' }
  vi.stubGlobal(
    'MediaMetadata',
    class {
      constructor(init: MediaMetadataInit) {
        Object.assign(this, init)
      }
    },
  )
  Object.defineProperty(navigator, 'mediaSession', {
    configurable: true,
    value: Object.assign(session, {
      setActionHandler: vi.fn<(action: MediaSessionAction, handler: MediaSessionActionHandler | null) => void>(),
    }),
  })
  return session
}

function coverRequest(url: string) {
  const parsed = new URL(url, 'http://localhost')
  return { path: parsed.pathname, medium: parsed.searchParams.get('medium'), version: parsed.searchParams.get('t') }
}

function backgroundImageUrls(wrapper: VueWrapper): string[] {
  return wrapper
    .findAll('div')
    .map((div) => /^url\("?(.*?)"?\)$/.exec((div.element as HTMLElement).style.backgroundImage)?.[1])
    .filter((url): url is string => url !== undefined)
}

let wrapper: VueWrapper | null = null

async function mountView() {
  wrapper = mount(AudiobookReaderView, {
    props: { bookId: BOOK_ID, fileId: FILE_ID },
    global: { stubs: { BookCoverPlaceholder: true } },
  })
  await flushPromises()
  return wrapper
}

describe('AudiobookReaderView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activeQueueLoadError = null
    mocks.createCoverFillArtworkUrl.mockResolvedValue(ARTWORK_URL)
    vi.stubGlobal(
      'URL',
      class extends URL {
        static revokeObjectURL = mocks.revokeObjectURL
      },
    )
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'mediaSession')
  })

  it('draws the cover and backdrop from the audio slot, versioned by coverVersion', async () => {
    serve(bookDetail())
    const view = await mountView()

    const coverFill = view.findComponent(CoverFill)
    expect(coverFill.exists()).toBe(true)
    const src = coverFill.props('src')
    expect(coverRequest(src)).toEqual({ path: `/api/v1/books/${BOOK_ID}/cover`, medium: 'audio', version: COVER_VERSION })
    expect(coverFill.props()).toMatchObject({ alt: 'The Long Orbit', loading: 'eager' })

    const backdrops = backgroundImageUrls(view)
    expect(backdrops.length).toBeGreaterThan(0)
    expect(new Set(backdrops)).toEqual(new Set([src]))

    const requestedCovers = mocks.coverUrl.mock.calls
    expect(requestedCovers.length).toBeGreaterThan(0)
    expect(requestedCovers).toEqual(requestedCovers.map(() => [BOOK_ID, 'cover', COVER_VERSION, 'audio']))
    expect(view.findComponent(BookCoverPlaceholder).exists()).toBe(false)
  })

  it('builds the media session artwork from the audio-slot cover', async () => {
    const session = stubMediaSession()
    serve(bookDetail())
    const view = await mountView()

    const src = view.findComponent(CoverFill).props('src')
    expect(coverRequest(src).medium).toBe('audio')
    expect(mocks.createCoverFillArtworkUrl).toHaveBeenCalledExactlyOnceWith(src)
    expect(session.metadata).toMatchObject({
      title: 'The Long Orbit',
      artist: 'Ada Vance',
      artwork: [{ src: ARTWORK_URL, sizes: '512x512', type: 'image/jpeg' }],
    })
  })

  it('shows the placeholder and requests no cover when the book has none', async () => {
    const session = stubMediaSession()
    serve(bookDetail({ coverSource: null, coverMedia: [], covers: { ebook: null, audio: null }, coverVersion: 'legacy:2026-09-01T00:00:00.000Z' }))
    const view = await mountView()

    expect(mocks.coverUrl).not.toHaveBeenCalled()
    expect(mocks.createCoverFillArtworkUrl).not.toHaveBeenCalled()
    expect(view.findComponent(CoverFill).exists()).toBe(false)
    expect(view.find('img').exists()).toBe(false)
    expect(backgroundImageUrls(view)).toEqual([])

    const placeholder = view.findComponent(BookCoverPlaceholder)
    expect(placeholder.exists()).toBe(true)
    expect(placeholder.props()).toMatchObject({ title: 'The Long Orbit', authorLine: 'Ada Vance', isAudio: true })
    expect(session.metadata).toMatchObject({ title: 'The Long Orbit', artist: 'Ada Vance', artwork: [] })
  })

  it('shows a queue failure even when playback is idle', async () => {
    serve(bookDetail())
    const view = await mountView()
    activeQueueLoadError!.value = 'Failed to load audio file'
    await flushPromises()

    expect(view.text()).toContain('Failed to load audio file')
    expect(view.text()).toContain('reader.audiobook.loadError')
  })
})
