import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PodcastDirectoryResult, PodcastFeedPreview } from '@bookorbit/types'
import { api } from '@/lib/api'
import { usePodcastFeedAdd } from './usePodcastFeedAdd'
import { jsonResponse } from '../test/fixtures'

const toastMocks = vi.hoisted(() => ({ success: vi.fn<() => void>(), error: vi.fn<() => void>() }))

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: toastMocks }))
vi.mock('@/lib/api', () => ({ api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() }))

const apiMock = vi.mocked(api)

function preview(overrides: Partial<PodcastFeedPreview> = {}): PodcastFeedPreview {
  return {
    feedUrl: 'https://example.com/feed.xml',
    title: 'Orbit Radio',
    author: 'BookOrbit',
    imageUrl: null,
    description: null,
    language: 'en',
    podcastType: 'episodic',
    explicit: false,
    categories: [],
    episodeCount: 12,
    ...overrides,
  }
}

describe('usePodcastFeedAdd', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('previews the current URL and invalidates the preview when the URL changes', async () => {
    apiMock.mockResolvedValueOnce(jsonResponse(preview()))
    const add = usePodcastFeedAdd(ref(7))
    add.feedUrl.value = ' https://example.com/feed.xml '

    await add.previewFeed()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcast-libraries/7/feed-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedUrl: 'https://example.com/feed.xml' }),
    })
    expect(add.preview.value?.title).toBe('Orbit Radio')
    expect(add.previewedFeedUrl.value).toBe('https://example.com/feed.xml')

    add.feedUrl.value = 'https://example.com/other.xml'
    await Promise.resolve()

    expect(add.preview.value).toBeNull()
    expect(add.previewedFeedUrl.value).toBe('')
  })

  it('does not let an older preview response replace a newly typed URL', async () => {
    let resolvePreview!: (response: Response) => void
    apiMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePreview = resolve
      }),
    )
    const add = usePodcastFeedAdd(ref(7))
    add.feedUrl.value = 'https://example.com/old.xml'
    const pending = add.previewFeed()

    add.feedUrl.value = 'https://example.com/new.xml'
    resolvePreview(jsonResponse(preview({ feedUrl: 'https://example.com/old.xml' })))
    await pending

    expect(add.preview.value).toBeNull()
  })

  it('does not let an older preview failure surface against a newly typed URL', async () => {
    let rejectPreview!: (reason: Error) => void
    apiMock.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectPreview = reject
      }),
    )
    const add = usePodcastFeedAdd(ref(7))
    add.feedUrl.value = 'https://example.com/old.xml'
    const pending = add.previewFeed()

    add.feedUrl.value = 'https://example.com/new.xml'
    rejectPreview(new Error('feed unreachable'))
    await pending

    expect(add.previewError.value).toBeNull()
    expect(add.previewing.value).toBe(false)
  })

  it('adds a validated feed with only the acquisition fields that apply', async () => {
    apiMock.mockResolvedValueOnce(jsonResponse(preview())).mockResolvedValueOnce(new Response(null, { status: 204 }))
    const add = usePodcastFeedAdd(ref(7))
    add.feedUrl.value = 'https://example.com/feed.xml'
    await add.previewFeed()
    add.acquisitionPolicy.value = 'newest'
    add.autoDownloadLimit.value = 5

    await expect(add.addFeed()).resolves.toBe(true)

    expect(JSON.parse(String(apiMock.mock.calls[1]?.[1]?.body))).toEqual({
      source: 'feed',
      feedUrl: 'https://example.com/feed.xml',
      acquisitionPolicy: 'newest',
      autoDownloadLimit: 5,
    })
    expect(toastMocks.success).toHaveBeenCalledWith('podcast.messages.podcastAdded')
  })

  it('rejects an invalid acquisition limit before sending a request', async () => {
    apiMock.mockResolvedValueOnce(jsonResponse(preview()))
    const add = usePodcastFeedAdd(ref(7))
    add.feedUrl.value = 'https://example.com/feed.xml'
    await add.previewFeed()
    add.acquisitionPolicy.value = 'newest'
    add.autoDownloadLimit.value = 0

    await expect(add.addFeed()).resolves.toBe(false)

    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(toastMocks.error).toHaveBeenCalledWith('podcast.errors.invalidEpisodeLimit')
  })

  it('returns an existing show id without trying to preview it', () => {
    const add = usePodcastFeedAdd(ref(7))
    const result: PodcastDirectoryResult = {
      title: 'Orbit Radio',
      author: null,
      feedUrl: 'https://example.com/feed.xml',
      artworkUrl: null,
      genre: null,
      existingPodcastId: 42,
      existingLibraryId: 7,
    }

    expect(add.selectDirectoryResult(result)).toBe(42)
    expect(apiMock).not.toHaveBeenCalled()
  })
})
