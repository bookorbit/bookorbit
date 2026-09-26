import { effectScope, reactive, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PodcastSummary } from '@bookorbit/types'
import { api } from '@/lib/api'
import { jsonResponse, makeShow } from '../test/fixtures'
import { usePodcastShowPage } from './usePodcastShowPage'

function show(id = 12): PodcastSummary {
  return makeShow({ id, title: `Orbit ${id}`, episodeCount: 1, unplayedCount: 1 })
}

const route = vi.hoisted(() => ({ query: {} as Record<string, string> }))
const routerMocks = vi.hoisted(() => ({ replace: vi.fn<() => Promise<void>>(async () => undefined) }))
const podcastEvents = await vi.hoisted(async () => {
  const { mockPodcastEvents } = await import('../test/stubs')
  return mockPodcastEvents()
})
const eventCallbacks = podcastEvents.callbacks
const eventMocks = podcastEvents
const toastMocks = vi.hoisted(() => ({ error: vi.fn<() => void>() }))

vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => routerMocks }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: toastMocks }))
vi.mock('@/lib/api', () => ({ api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() }))
vi.mock('@/composables/useInfiniteScrollSentinel', () => ({ useInfiniteScrollSentinel: () => ({ sentinel: ref(null) }) }))
vi.mock('./usePodcastAnnouncer', () => ({ usePodcastAnnouncer: () => ({ announce: vi.fn<() => void>() }) }))
vi.mock('./usePodcastEvents', () => ({ usePodcastEvents: podcastEvents.usePodcastEvents }))

const apiMock = vi.mocked(api)
let stopScope: (() => void) | null = null

function createPage(podcastId = ref(12)) {
  const fetchLibraries = vi.fn<() => Promise<void>>(async () => undefined)
  const scope = effectScope()
  const page = scope.run(() => usePodcastShowPage(podcastId, fetchLibraries))!
  stopScope = () => scope.stop()
  return { page, podcastId, fetchLibraries }
}

describe('usePodcastShowPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    route.query = reactive({}) as Record<string, string>
    apiMock.mockImplementation(async (url) =>
      url === '/api/v1/podcasts/12' ? jsonResponse(show()) : jsonResponse({ items: [], total: 0, page: 1, size: 100 }),
    )
  })

  afterEach(() => {
    stopScope?.()
    stopScope = null
    vi.useRealTimers()
  })

  it('loads the show and bounded episode page from route filters', async () => {
    route.query = reactive({ q: ' moon ', filter: 'unplayed', sort: 'oldest', from: '2026-01-01' }) as Record<string, string>
    const { page, fetchLibraries } = createPage()
    await flushPromises()

    expect(fetchLibraries).toHaveBeenCalledOnce()
    expect(eventMocks.subscribeLibrary).toHaveBeenCalledWith(7)
    expect(page.show.value?.title).toBe('Orbit 12')
    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/podcast-libraries/7/episodes?page=0&size=100&filter=unplayed&sort=oldest&podcastId=12&q=moon&publishedFrom=2026-01-01',
    )
  })

  it('ignores an older show response after the route targets a different podcast', async () => {
    let resolveOld!: (response: Response) => void
    apiMock.mockImplementation(async (url) => {
      if (url === '/api/v1/podcasts/12') return new Promise((resolve) => (resolveOld = resolve))
      if (url === '/api/v1/podcasts/13') return jsonResponse(show(13))
      return jsonResponse({ items: [], total: 0, page: 1, size: 100 })
    })
    const { page, podcastId } = createPage()
    await Promise.resolve()
    podcastId.value = 13
    await flushPromises()
    resolveOld(jsonResponse(show(12)))
    await flushPromises()

    expect(page.show.value?.id).toBe(13)
  })

  it('debounces route search updates', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { page } = createPage()
    await flushPromises()
    routerMocks.replace.mockClear()

    page.episodeSearch.value = 'launch'
    await vi.advanceTimersByTimeAsync(300)

    expect(routerMocks.replace).toHaveBeenCalledWith({
      query: { q: 'launch', filter: undefined, sort: undefined, from: undefined, to: undefined },
    })
  })

  it('rejects an inverted date range without changing the route', async () => {
    const { page } = createPage()
    await flushPromises()
    routerMocks.replace.mockClear()
    page.publishedFrom.value = '2026-08-02'
    page.publishedTo.value = '2026-08-01'

    await page.updateEpisodeQuery()

    expect(routerMocks.replace).not.toHaveBeenCalled()
    expect(toastMocks.error).toHaveBeenCalledWith('podcast.errors.invalidDateRange')
  })

  it('applies refresh events to the loaded show and totals', async () => {
    const { page } = createPage()
    await flushPromises()

    eventCallbacks.refreshComplete?.({
      libraryId: 7,
      podcastId: 12,
      newEpisodes: 0,
      consecutiveFailures: 2,
      lastError: 'Timeout',
    })

    expect(page.show.value?.consecutiveFailures).toBe(2)
    expect(page.refreshResult.value).toEqual({ newEpisodes: 0, error: 'Timeout' })
  })
})
