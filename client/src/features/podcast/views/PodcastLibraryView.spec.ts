import { reactive, ref } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  PodcastBulkActionResult,
  PodcastEpisodeListItem,
  PodcastFeedHealth,
  PodcastListItem,
  PodcastQueueClearResult,
  PodcastQueueItem,
} from '@bookorbit/types'
import { api } from '@/lib/api'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import SelectionActionBar from '@/components/SelectionActionBar.vue'
import PodcastAddFeedSheet from '../components/PodcastAddFeedSheet.vue'
import PodcastImportSheet from '../components/PodcastImportSheet.vue'
import PodcastOpmlImportSheet from '../components/PodcastOpmlImportSheet.vue'
import PodcastViewHeader from '../components/PodcastViewHeader.vue'
import PodcastLibraryView from './PodcastLibraryView.vue'
import { makeEpisodeListItem } from '../test/fixtures'
import { createPodcastsStub } from '../test/stubs'

const observerCallbacks: IntersectionObserverCallback[] = []
const observedElements: Element[] = []

const routerMocks = vi.hoisted(() => ({ replace: vi.fn<() => Promise<void>>(async () => undefined), push: vi.fn<() => void>() }))
const route = vi.hoisted(() => ({ params: { id: '7' }, query: {} as Record<string, string> }))
const podcastMock = vi.hoisted(() => ({ value: null as unknown }))
const toastMocks = vi.hoisted(() => ({ success: vi.fn<() => void>(), error: vi.fn<() => void>() }))
const queueMock = vi.hoisted(() => ({
  reorder: vi.fn<() => Promise<void>>(async () => undefined),
  clear: vi.fn<() => Promise<PodcastQueueClearResult>>(async () => ({ removed: 2, previousEpisodeIds: [1, 2] })),
  clearFinished: vi.fn<() => Promise<PodcastQueueClearResult>>(async () => ({ removed: 1, previousEpisodeIds: [1] })),
  restore: vi.fn<() => Promise<number>>(async () => 2),
}))
const playerMocks = vi.hoisted(() => ({
  playInline: vi.fn<(episodeId: number) => Promise<void>>(async () => undefined),
  togglePlayback: vi.fn<() => void>(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => routerMocks,
}))
vi.mock('vue-sonner', () => ({ toast: toastMocks }))
vi.mock('vue-virtual-scroller', async () => {
  const { virtualScrollerStubs } = await import('../test/stubs')
  return virtualScrollerStubs()
})
vi.mock('vue-virtual-scroller/dist/vue-virtual-scroller.css', () => ({}))
vi.mock('@/lib/api', () => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(null, { status: 204 })),
}))
vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({ libraries: ref([{ id: 7, name: 'Podcasts', accessLevel: 'owner' }]) }),
}))
vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true, isSuperuser: ref(true) }),
}))
vi.mock('../composables/usePodcastPlayer', () => ({
  usePodcastPlayer: () => ({
    episode: ref(null),
    isPlaying: ref(false),
    queueEpisodeNext: vi.fn<() => Promise<void>>(),
    playInline: playerMocks.playInline,
    togglePlayback: playerMocks.togglePlayback,
  }),
}))
vi.mock('../composables/usePodcastQueue', () => ({ usePodcastQueue: () => queueMock, notifyEpisodesDequeued: vi.fn<() => void>() }))
vi.mock('../composables/usePodcasts', () => ({ usePodcasts: () => podcastMock.value }))
const podcastEvents = await vi.hoisted(async () => {
  const { mockPodcastEvents } = await import('../test/stubs')
  return mockPodcastEvents()
})
vi.mock('../composables/usePodcastEvents', () => ({ usePodcastEvents: podcastEvents.usePodcastEvents }))

const queuePlaylistEpisodesMock = vi.hoisted(() =>
  vi.fn<() => Promise<PodcastBulkActionResult>>(async () => ({ completed: 4, failed: 0, skipped: 1, firstEpisodeId: 91 })),
)

const apiMock = vi.mocked(api)

function createPodcastState(
  queue: PodcastQueueItem[] = [],
  shows: PodcastListItem[] = [],
  health: PodcastFeedHealth[] = [],
  episodes: PodcastEpisodeListItem[] = [],
) {
  return createPodcastsStub({ shows, queue, health, episodes }, { queuePlaylistEpisodes: queuePlaylistEpisodesMock, search: ref(searchFromRoute()) })
}

function searchFromRoute(): string {
  return typeof route.query.q === 'string' ? route.query.q : ''
}

function healthItem(overrides: Partial<PodcastFeedHealth> = {}): PodcastFeedHealth {
  return {
    podcastId: 3,
    title: 'Orbit Radio',
    lastRefreshAt: null,
    lastRefreshSuccessAt: null,
    consecutiveFailures: 0,
    nextRefreshAt: '2026-08-01T00:00:00.000Z',
    lastError: null,
    lastHttpStatus: null,
    ...overrides,
  }
}

function queueItem(id: number): PodcastQueueItem {
  return {
    id,
    libraryId: 2,
    origin: 'feed',
    podcastId: 3,
    podcastTitle: 'Orbit Radio',
    podcastImageUrl: null,
    title: `Episode ${id}`,
    season: null,
    episode: null,
    explicit: false,
    inFeed: true,
    publishedAt: null,
    durationSeconds: 600,
    audioFormat: null,
    mediaStatus: 'remote',
    localSizeBytes: null,
    checksum: null,
    positionSeconds: 0,
    progressPercent: 0,
    finished: true,
    pinned: false,
    queued: true,
    lastListenedAt: null,
    queuePosition: 0,
  }
}

async function mountView(
  query: Record<string, string> = {},
  queue: PodcastQueueItem[] = [],
  shows: PodcastListItem[] = [],
  health: PodcastFeedHealth[] = [],
  episodes: PodcastEpisodeListItem[] = [],
) {
  route.query = reactive(query) as Record<string, string>
  podcastMock.value = createPodcastState(queue, shows, health, episodes)
  const wrapper = mount(PodcastLibraryView)
  await flushPromises()
  return wrapper
}

/** The dialog actually on screen: the view mounts more than one, and only the open one is asked about. */
function openConfirmDialog(wrapper: VueWrapper) {
  const dialog = wrapper.findAllComponents(ConfirmDialog).find((candidate) => candidate.props('open') === true)
  if (!dialog) throw new Error('no open ConfirmDialog')
  return dialog
}

describe('PodcastLibraryView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    apiMock.mockImplementation(async () => new Response(null, { status: 204 }))
    // Sheets teleport into the body, so a test that fails before unmounting would otherwise leave
    // elements the next test's queries would find first.
    document.body.innerHTML = ''
    observerCallbacks.length = 0
    observedElements.length = 0
    Object.defineProperty(globalThis, 'IntersectionObserver', {
      configurable: true,
      writable: true,
      value: class {
        constructor(callback: IntersectionObserverCallback) {
          observerCallbacks.push(callback)
        }
        observe(element: Element) {
          if (!(element instanceof Element)) throw new TypeError('IntersectionObserver target must be an Element')
          observedElements.push(element)
        }
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return []
        }
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the active search and follow filter when switching views', async () => {
    const wrapper = await mountView({ view: 'shows', q: 'orbit', followed: '1' })

    await wrapper
      .findAll('nav button')
      .find((button) => button.text() === 'Episodes')!
      .trigger('click')

    expect(routerMocks.replace).toHaveBeenCalledWith({ query: { view: 'episodes', q: 'orbit', followed: '1', filter: 'latest' } })
  })

  it('keeps the rendered tab visible while an unvisited tab loads', async () => {
    const wrapper = await mountView({ view: 'shows' }, [], [showItem()])
    const state = podcastMock.value as ReturnType<typeof createPodcastState>
    let finishLoading!: () => void
    const loadingFinished = new Promise<void>((resolve) => {
      finishLoading = resolve
    })
    state.lanes.episodes.initialized.value = false
    vi.mocked(state.loadEpisodes).mockImplementationOnce(async () => {
      state.lanes.episodes.loading.value = true
      await loadingFinished
      state.lanes.episodes.initialized.value = true
      state.lanes.episodes.loading.value = false
    })

    route.query.view = 'episodes'
    await flushPromises()

    expect(wrapper.find('[data-testid="podcast-initial-loading"]').exists()).toBe(false)
    expect(wrapper.find('button[title="Orbit Radio"]').exists()).toBe(true)

    finishLoading()
    await flushPromises()

    expect(wrapper.find('button[title="Orbit Radio"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('No episodes yet')
  })

  it('debounces typed search instead of requiring a submit', async () => {
    const wrapper = await mountView({ view: 'shows' })

    await wrapper.get('input[placeholder="Search shows"]').setValue('orbit')

    expect(routerMocks.replace).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(300)

    expect(routerMocks.replace).toHaveBeenCalledWith({ query: { view: 'shows', q: 'orbit' } })
  })

  it('searches through the shared view header on every view, queue included', async () => {
    const wrapper = await mountView({ view: 'queue' }, [queueItem(1)])

    expect(wrapper.findComponent(PodcastViewHeader).props('searchPlaceholder')).toBe('Search your queue')
    expect(wrapper.findAll('form[role="search"]')).toHaveLength(0)
  })

  it('starts show-card playback inline without changing the route', async () => {
    const wrapper = await mountView({ view: 'shows' }, [], [showItem()])
    routerMocks.push.mockClear()

    await wrapper.get('button[aria-label="Play latest episode Launch"]').trigger('click')

    expect(playerMocks.playInline).toHaveBeenCalledWith(42)
    expect(routerMocks.push).not.toHaveBeenCalled()
  })

  it('starts queue playback inline without changing the route', async () => {
    const wrapper = await mountView({ view: 'queue' }, [queueItem(42)])
    routerMocks.push.mockClear()

    await wrapper.get('button[aria-label="Play Episode 42"]').trigger('click')

    expect(playerMocks.playInline).toHaveBeenCalledWith(42)
    expect(routerMocks.push).not.toHaveBeenCalled()
  })

  it('confirms before clearing the queue rather than clearing on the first click', async () => {
    const wrapper = await mountView({ view: 'queue' }, [queueItem(1), queueItem(2)])

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Clear queue')!
      .trigger('click')

    expect(queueMock.clear).not.toHaveBeenCalled()
    const dialog = openConfirmDialog(wrapper)
    expect(dialog.props('title')).toBe('Clear queue')

    dialog.vm.$emit('confirm')
    await flushPromises()

    expect(queueMock.clear).toHaveBeenCalledOnce()
  })

  it('confirms before clearing played episodes', async () => {
    const wrapper = await mountView({ view: 'queue' }, [queueItem(1)])

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Clear played')!
      .trigger('click')

    expect(queueMock.clearFinished).not.toHaveBeenCalled()
    const dialog = openConfirmDialog(wrapper)
    expect(dialog.props('description')).toBe('Remove every played episode from the queue?')

    dialog.vm.$emit('confirm')
    await flushPromises()

    expect(queueMock.clearFinished).toHaveBeenCalledOnce()
  })

  it('offers an undo that restores the pre-clear queue order', async () => {
    const wrapper = await mountView({ view: 'queue' }, [queueItem(1), queueItem(2)])

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Clear queue')!
      .trigger('click')
    openConfirmDialog(wrapper).vm.$emit('confirm')
    await flushPromises()

    expect(toastMocks.success).toHaveBeenCalledWith('Podcast queue cleared', {
      action: { label: 'Undo', onClick: expect.any(Function) },
    })

    const [, options] = toastMocks.success.mock.calls.at(-1) as unknown as [string, { action: { onClick: () => void } }]
    options.action.onClick()
    await flushPromises()

    expect(queueMock.restore).toHaveBeenCalledWith([1, 2])
  })

  it('sorts shows through the route so the choice survives a reload', async () => {
    const wrapper = await mountView({ view: 'shows' }, [], [showItem()])

    await wrapper.get('button[aria-label="Sort shows"]').trigger('click')
    await flushPromises()

    const options = document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')
    options[1]?.click()
    await flushPromises()

    expect(routerMocks.replace).toHaveBeenCalledWith({ query: { view: 'shows', sort: 'recent' } })
    wrapper.unmount()
  })

  it('drops a sort that does not apply to the view being opened', async () => {
    const wrapper = await mountView({ view: 'shows', sort: 'recent' }, [], [showItem()])

    await wrapper
      .findAll('nav button')
      .find((button) => button.text() === 'Episodes')!
      .trigger('click')

    expect(routerMocks.replace).toHaveBeenCalledWith({ query: { view: 'episodes', filter: 'latest', sort: undefined } })
  })

  it('offers a way out of an empty queue', async () => {
    const wrapper = await mountView({ view: 'queue' })

    const actions = wrapper.findAll('button').map((button) => button.text())

    expect(actions).toContain('Browse episodes')
    expect(actions).toContain('Browse shows')
  })

  it('keeps browse navigation and its controls inside one sticky header', async () => {
    const wrapper = await mountView({ view: 'shows' }, [], [showItem()])

    const header = wrapper.findComponent(PodcastViewHeader)
    expect(header.props('title')).toBe('Podcasts')
    expect(header.props('total')).toBe(1)
    expect(wrapper.findAll('.sticky')).toHaveLength(1)
    expect(wrapper.get('.sticky').find('nav').exists()).toBe(true)
  })

  it('counts only the tab being viewed, since the others have no loaded total', async () => {
    const state = createPodcastState([], [showItem()])
    state.totalShows.value = 2
    podcastMock.value = state
    route.query = reactive({ view: 'shows' }) as Record<string, string>
    const wrapper = mount(PodcastLibraryView)
    await flushPromises()

    const tabs = wrapper.findAll('nav button')
    expect(tabs.find((tab) => tab.text().startsWith('Shows'))!.text()).toBe('Shows 2')
    expect(tabs.find((tab) => tab.text().startsWith('Episodes'))!.text()).toBe('Episodes')
  })

  /** Answers the library-wide activity counters, which is where the health badge gets its truth. */
  function respondWithFailingFeeds(failingFeeds: number) {
    apiMock.mockImplementation(async (input) => {
      if (String(input).includes('/activity')) {
        const body = { jobs: { queued: 0, processing: 0, failed: 0 }, importScan: null, downloads: {}, failingFeeds }
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(null, { status: 204 })
    })
  }

  it('moves feed health out of the browse navigation and flags failures across the library', async () => {
    respondWithFailingFeeds(1)
    const wrapper = await mountView({ view: 'shows' })
    await flushPromises()

    expect(wrapper.findAll('nav button').map((button) => button.text())).not.toContain('Manage feeds')
    expect(wrapper.find('[data-testid="podcast-feed-health-badge"]').exists()).toBe(true)

    await wrapper.get('[data-testid="podcast-feed-health"]').trigger('click')

    expect(routerMocks.replace).toHaveBeenCalledWith({ query: { view: 'health', filter: undefined, sort: undefined } })
  })

  /**
   * The badge used to be read off the loaded page of shows, so it vanished whenever that page was
   * filtered, paged past, or never loaded at all. A failing row on screen must no longer be what
   * decides it, and a library-wide count must raise it even with no failing row loaded.
   */
  it('ignores a failing row on screen and trusts the library-wide count instead', async () => {
    respondWithFailingFeeds(0)
    const failingShow = { ...showItem(), consecutiveFailures: 2 }
    const wrapper = await mountView({ view: 'shows' }, [], [failingShow])
    await flushPromises()

    expect(wrapper.find('[data-testid="podcast-feed-health-badge"]').exists()).toBe(false)
  })

  it('renders the feed health view as a headed page', async () => {
    const wrapper = await mountView({ view: 'health' })

    expect(wrapper.get('h2').text()).toBe('Manage feeds')
  })

  it('queues a reparse of the stored feed from the health row', async () => {
    const wrapper = await mountView({ view: 'health' }, [], [], [healthItem()])

    await wrapper.get('button[aria-label="Reparse the stored feed for Orbit Radio"]').trigger('click')
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcasts/3/reparse', { method: 'POST' })
    expect(toastMocks.success).toHaveBeenCalledWith('Podcast reparse queued')
  })

  it('explains a reparse the server has no stored copy for', async () => {
    apiMock.mockImplementation(async () => new Response(null, { status: 404 }))
    const wrapper = await mountView({ view: 'health' }, [], [], [healthItem()])

    await wrapper.get('button[aria-label="Reparse the stored feed for Orbit Radio"]').trigger('click')
    await flushPromises()

    expect(toastMocks.error).toHaveBeenCalledWith('BookOrbit has no stored copy of this feed yet. Refresh it first.')
  })

  it('offers queue selection in the context row only on the queue view', async () => {
    // The shows view carries a Select of its own, so what marks the queue row is its queue actions.
    const showsView = await mountView({ view: 'shows' }, [], [showItem()])
    expect(showsView.findAll('button').map((button) => button.text())).not.toContain('Clear queue')

    const queueView = await mountView({ view: 'queue' }, [queueItem(1)])
    const queueButtons = queueView.findAll('button').map((button) => button.text())
    expect(queueButtons).toContain('Select')
    expect(queueButtons).toContain('Clear queue')
  })

  it('offers the missing filter only once a show is actually missing', async () => {
    const healthy = await mountView({ view: 'shows' }, [], [showItem()])
    expect(healthy.findAll('button').map((button) => button.text())).not.toContain('Missing')

    const withMissing = await mountView({ view: 'shows' }, [], [showItem(), { ...showItem(), id: 4, missingAt: '2026-08-12T00:00:00.000Z' }])
    expect(withMissing.findAll('button').map((button) => button.text())).toContain('Missing')
  })

  it('reveals the show delete action only once something is picked', async () => {
    const wrapper = await mountView({ view: 'shows' }, [], [showItem()])
    expect(wrapper.findAll('button').map((button) => button.text())).not.toContain('Delete')

    const select = wrapper.findAll('button').find((button) => button.text() === 'Select')
    await select?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('0 selected')
    const deleteButton = wrapper.findAll('button').find((button) => button.text() === 'Delete')
    expect(deleteButton?.attributes('disabled')).toBeDefined()
  })

  it('reveals the bulk action bar and row checkboxes only in selection mode', async () => {
    const wrapper = await mountView({ view: 'queue' }, [queueItem(1), queueItem(2)])

    expect(wrapper.findComponent(SelectionActionBar).props('visible')).toBe(false)
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0)

    await toggleSelection(wrapper)

    expect(wrapper.findComponent(SelectionActionBar).props('visible')).toBe(true)
    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    expect(checkboxes).toHaveLength(2)

    await checkboxes[0]!.setValue(true)

    expect(wrapper.findComponent(SelectionActionBar).props('count')).toBe(1)
  })

  it('only offers display controls where a grid can use them', async () => {
    const showsView = await mountView({ view: 'shows' }, [], [showItem()])
    expect(showsView.findComponent(PodcastViewHeader).props('showDisplayControls')).toBe(true)

    const episodesView = await mountView({ view: 'episodes' })
    expect(episodesView.findComponent(PodcastViewHeader).props('showDisplayControls')).toBe(false)
  })

  it('appends the next page when the sentinel scrolls into view instead of paging with buttons', async () => {
    const state = createPodcastState([], [showItem()])
    state.totalShows.value = 120
    state.lanes.shows.hasMore.value = true
    podcastMock.value = state
    route.query = reactive({ view: 'shows' }) as Record<string, string>
    const wrapper = mount(PodcastLibraryView)
    await flushPromises()

    const actions = wrapper.findAll('button').map((button) => button.text())
    expect(actions).not.toContain('Next')
    expect(actions).not.toContain('Previous')
    expect(observedElements.at(-1)).toBeInstanceOf(HTMLDivElement)

    vi.mocked(state.loadShows).mockClear()
    observerCallbacks.at(-1)?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    await flushPromises()

    expect(state.loadShows).toHaveBeenCalledWith(true)
  })

  it('browses a built-in playlist through the shared episode list', async () => {
    const wrapper = await mountView({ view: 'playlists' })
    const state = podcastMock.value as ReturnType<typeof createPodcastState>

    expect(wrapper.findAll('nav button').some((button) => button.text().startsWith('Playlists'))).toBe(true)
    expect(state.playlistRules.value).toMatchObject({ filter: 'unplayed', sort: 'shortest', maxDurationMinutes: 20 })
    expect(state.loadEpisodes).toHaveBeenCalled()
    expect(wrapper.get('[data-testid="podcast-playlist-summary"]').text()).toContain('episodes')
    expect(wrapper.findAll('button').map((button) => button.text())).toEqual(
      expect.arrayContaining(['Quick listens', 'Continue listening', 'Downloaded', 'Fresh this week']),
    )
  })

  it('queues the whole playlist in one call and starts the first match inline', async () => {
    const wrapper = await mountView({ view: 'playlists' })
    const state = podcastMock.value as ReturnType<typeof createPodcastState>
    state.episodes.value = [{ id: 91 }] as never

    await flushPromises()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Play all')!
      .trigger('click')
    await flushPromises()

    expect(queuePlaylistEpisodesMock).toHaveBeenCalledTimes(1)
    expect(queuePlaylistEpisodesMock).toHaveBeenCalledWith(expect.objectContaining({ filter: 'unplayed', maxDurationMinutes: 20 }))
    expect(playerMocks.playInline).toHaveBeenCalledWith(91)
    expect(routerMocks.push).not.toHaveBeenCalled()
  })

  it('reports the playlist queue outcome including what it skipped', async () => {
    const wrapper = await mountView({ view: 'playlists' })
    const state = podcastMock.value as ReturnType<typeof createPodcastState>
    state.episodes.value = [{ id: 91 }] as never

    await flushPromises()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Queue all')!
      .trigger('click')
    await flushPromises()

    expect(toastMocks.success).toHaveBeenCalledWith('Queued 4 episodes, skipped 1')
    expect(playerMocks.playInline).not.toHaveBeenCalled()
  })

  it('offers to reset the filter when a filtered episode list is empty', async () => {
    const wrapper = await mountView({ view: 'episodes', filter: 'downloaded' })

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Show all episodes')!
      .trigger('click')

    expect(routerMocks.replace).toHaveBeenCalledWith({
      query: { view: 'episodes', filter: undefined, followed: undefined },
    })
  })

  it('names the active filter in the empty state instead of interpolating a lowercased label', async () => {
    const downloaded = await mountView({ view: 'episodes', filter: 'downloaded' })
    expect(downloaded.text()).toContain('No downloaded episodes')

    const inProgress = await mountView({ view: 'episodes', filter: 'in_progress' })
    expect(inProgress.text()).toContain('No episodes in progress')

    const latest = await mountView({ view: 'episodes' })
    expect(latest.text()).toContain('No episodes yet')
    expect(latest.findComponent(EmptyState).exists()).toBe(true)
  })

  it('explains retention when the pinned filter is empty', async () => {
    const wrapper = await mountView({ view: 'episodes', filter: 'pinned' })

    expect(wrapper.text()).toContain('No pinned episodes')
    expect(wrapper.text()).toContain('Pinned episodes are protected from storage retention removal.')
  })

  it('opens the OPML and local-file sheets when the add-feed sheet hands off', async () => {
    const wrapper = await mountView({ view: 'shows' })

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Add feed')!
      .trigger('click')
    await flushPromises()

    const addFeed = wrapper.findComponent(PodcastAddFeedSheet)
    addFeed.vm.$emit('import-local')
    await flushPromises()
    expect(wrapper.findComponent(PodcastImportSheet).props('open')).toBe(true)

    addFeed.vm.$emit('import-opml')
    await flushPromises()
    expect(wrapper.findComponent(PodcastOpmlImportSheet).props('open')).toBe(true)
    wrapper.unmount()
  })

  it('seeds the job banner from the counts an OPML import reports', async () => {
    const wrapper = await mountView({ view: 'shows' })

    wrapper.findComponent(PodcastOpmlImportSheet).vm.$emit('imported', { total: 12, queued: 12 })
    await flushPromises()

    expect(wrapper.text()).toContain('12 queued')
    wrapper.unmount()
  })

  it('renders episode rows on the episodes tab and routes a row action through the shared actions', async () => {
    const wrapper = await mountView({ view: 'episodes' }, [], [], [], [makeEpisodeListItem({ id: 42, title: 'Episode 42' })])

    expect(wrapper.text()).toContain('Episode 42')

    await wrapper.get('button[aria-label="Play Episode 42"]').trigger('click')

    expect(playerMocks.playInline).toHaveBeenCalledWith(42)
  })

  it('bulk removes the queue selection and reloads what is left', async () => {
    const wrapper = await mountView({ view: 'queue' }, [queueItem(1), queueItem(2)])
    const state = podcastMock.value as ReturnType<typeof createPodcastState>

    await toggleSelection(wrapper)
    await wrapper.findAll('input[type="checkbox"]')[0]!.setValue(true)
    vi.mocked(state.loadQueue).mockClear()

    await wrapper.get('[data-testid="podcast-bulk-remove-from-queue"]').trigger('click')
    await flushPromises()

    expect(state.removeFromQueue).toHaveBeenCalledTimes(1)
    expect(state.removeFromQueue).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
    expect(state.loadQueue).toHaveBeenCalledOnce()
    expect(wrapper.findComponent(SelectionActionBar).props('count')).toBe(0)
  })

  it('offers a retry when the first load of a view fails', async () => {
    const wrapper = await mountView({ view: 'shows' })
    const state = podcastMock.value as ReturnType<typeof createPodcastState>
    state.lanes.shows.error.value = 'The podcast library could not be loaded.'
    state.lanes.shows.initialized.value = false
    await flushPromises()
    vi.mocked(state.loadShows).mockClear()

    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('The podcast library could not be loaded.')
    await alert.get('button').trigger('click')

    expect(state.loadShows).toHaveBeenCalledOnce()
  })
})

async function toggleSelection(wrapper: VueWrapper) {
  await wrapper
    .findAll('button')
    .find((button) => button.text() === 'Select')!
    .trigger('click')
  await flushPromises()
}

function showItem(): PodcastListItem {
  return {
    id: 3,
    libraryId: 7,
    origin: 'feed',
    title: 'Orbit Radio',
    author: 'Orbit',
    imageUrl: null,
    episodeCount: 1,
    unplayedCount: 1,
    downloadedCount: 0,
    latestPublishedAt: '2026-07-29T00:00:00.000Z',
    consecutiveFailures: 0,
    playbackRecommendation: {
      episodeId: 42,
      title: 'Launch',
      positionSeconds: 0,
      durationSeconds: 600,
      kind: 'latest',
    },
    followed: false,
    notificationMode: 'off',
    archivedAt: null,
    missingAt: null,
  }
}
