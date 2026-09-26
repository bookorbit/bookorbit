import { reactive, ref } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PodcastEpisodeListItem, PodcastSummary } from '@bookorbit/types'
import { Permission } from '@bookorbit/types'
import { api } from '@/lib/api'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import PodcastShowView from './PodcastShowView.vue'
import PodcastEditDetailsSheet from '../components/PodcastEditDetailsSheet.vue'
import PodcastEpisodeRow from '../components/PodcastEpisodeRow.vue'
import { jsonResponse } from '../test/fixtures'

const route = vi.hoisted(() => ({ params: { podcastId: '12' }, query: {} as Record<string, string> }))
const routerMocks = vi.hoisted(() => ({
  push: vi.fn<() => void>(),
  replace: vi.fn<() => Promise<void>>(async () => undefined),
  back: vi.fn<() => void>(),
}))
const playerMocks = vi.hoisted(() => ({
  playInline: vi.fn<(episodeId: number) => Promise<void>>(async () => undefined),
  togglePlayback: vi.fn<() => void>(),
}))
const permissionMocks = vi.hoisted(() => ({ denied: new Set<string>() }))
const podcastEvents = await vi.hoisted(async () => {
  const { mockPodcastEvents } = await import('../test/stubs')
  return mockPodcastEvents()
})
const eventCallbacks = podcastEvents.callbacks
const downloadBatchMocks = vi.hoisted(() => ({ track: vi.fn<(batchId: string | null) => Promise<void>>(async () => undefined) }))

vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => routerMocks,
}))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() } }))
vi.mock('vue-virtual-scroller', async () => {
  const { virtualScrollerStubs } = await import('../test/stubs')
  return virtualScrollerStubs()
})
vi.mock('vue-virtual-scroller/dist/vue-virtual-scroller.css', () => ({}))
vi.mock('@/lib/api', () => ({ api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>() }))
vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({
    libraries: ref([{ id: 7, name: 'Podcasts', accessLevel: 'owner' }]),
    fetchLibraries: vi.fn<() => Promise<void>>(async () => undefined),
  }),
}))
vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (permission: string) => !permissionMocks.denied.has(permission), isSuperuser: ref(true) }),
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
vi.mock('../composables/usePodcastQueue', () => ({
  usePodcastQueue: () => ({ add: vi.fn<() => Promise<void>>(), remove: vi.fn<() => Promise<void>>() }),
  notifyEpisodesDequeued: vi.fn<() => void>(),
}))
vi.mock('../composables/usePodcastEvents', () => ({ usePodcastEvents: podcastEvents.usePodcastEvents }))
vi.mock('../composables/usePodcastDownloadBatches', () => ({
  usePodcastDownloadBatches: () => downloadBatchMocks,
}))

const apiMock = vi.mocked(api)

function show(overrides: Partial<PodcastSummary> = {}): PodcastSummary {
  return {
    id: 12,
    libraryId: 7,
    origin: 'feed',
    title: 'Orbit Radio',
    author: 'Orbit',
    description: null,
    imageUrl: '/api/v1/podcasts/12/artwork',
    siteUrl: null,
    language: null,
    podcastType: null,
    explicit: false,
    categories: [],
    acquisitionPolicy: 'remote_only',
    autoDownloadLimit: null,
    autoDownloadWindowDays: null,
    downloadCleanup: 'keep',
    downloadCleanupDelayHours: 24,
    refreshIntervalMinutes: 60,
    lockedFields: [],
    artworkUpdatedAt: null,
    episodeCount: 4,
    unplayedCount: 4,
    downloadedCount: 0,
    playbackRecommendation: null,
    followed: false,
    notificationMode: 'off',
    archivedAt: null,
    missingAt: null,
    lastRefreshAt: null,
    lastRefreshSuccessAt: null,
    feedSnapshotAt: null,
    consecutiveFailures: 0,
    nextRefreshAt: '2026-07-29T00:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

async function mountView(summary: PodcastSummary, episodes: PodcastEpisodeListItem[] = [], query: Record<string, string> = {}) {
  route.query = reactive(query) as Record<string, string>
  apiMock.mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/api/v1/podcasts/12') return jsonResponse(summary)
    if (url.includes('/episodes')) return jsonResponse({ items: episodes, total: episodes.length, page: 1, size: 100 })
    return new Response(null, { status: 204 })
  })
  const wrapper = mount(PodcastShowView)
  await flushPromises()
  return wrapper
}

async function openShowActions(wrapper: VueWrapper) {
  await wrapper.get('button[aria-label="More show actions"]').trigger('click')
  await flushPromises()
}

async function clickShowAction(wrapper: VueWrapper, testId: string) {
  await openShowActions(wrapper)
  document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.click()
  await flushPromises()
}

async function openManageSheet(wrapper: VueWrapper): Promise<HTMLElement> {
  await clickShowAction(wrapper, 'podcast-open-settings')
  document.body.querySelector<HTMLElement>('[data-testid="podcast-open-manage"]')?.click()
  await flushPromises()
  return document.body.querySelector<HTMLElement>('[data-testid="podcast-manage-dialog"]')!
}

describe('PodcastShowView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    permissionMocks.denied.clear()
    eventCallbacks.retentionEvicted = null
    // Sheets and dialogs teleport into the body, so a test that fails before unmounting would
    // otherwise leave elements the next test's queries would find first.
    document.body.innerHTML = ''
  })

  it('surfaces a failing feed on the show page itself', async () => {
    const wrapper = await mountView(show({ consecutiveFailures: 3, lastRefreshSuccessAt: null }))

    const banner = wrapper.get('[data-testid="podcast-feed-failure-banner"]')
    expect(banner.text()).toContain('Feed needs attention')
    expect(banner.text()).toContain('3 consecutive refresh failures')
    expect(banner.text()).toContain('Never')
  })

  it('does not warn about a healthy feed', async () => {
    const wrapper = await mountView(show())

    expect(wrapper.find('[data-testid="podcast-feed-failure-banner"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="podcast-archived-banner"]').exists()).toBe(false)
  })

  it('marks an archived show without relying on the settings dialog', async () => {
    const wrapper = await mountView(show({ archivedAt: '2026-07-20T00:00:00.000Z' }))

    expect(wrapper.get('[data-testid="podcast-archived-banner"]').text()).toContain('This show is archived')
  })

  it('falls back to the placeholder when show artwork fails to load', async () => {
    const wrapper = await mountView(show())
    expect(wrapper.get('img').attributes('src')).toBe('/api/v1/podcasts/12/artwork')

    await wrapper.get('img').trigger('error')

    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('renders show metadata, library context, hero stats, and a safe website link', async () => {
    const wrapper = await mountView(
      show({
        siteUrl: 'https://example.com/orbit',
        language: 'en',
        podcastType: 'serial',
        explicit: true,
        categories: ['Science', 'Space', 'Technology', 'History'],
        unplayedCount: 3,
        lastRefreshSuccessAt: new Date().toISOString(),
      }),
    )

    expect(wrapper.text()).toContain('Back to Podcasts')
    expect(wrapper.text()).toContain('3 unplayed')
    expect(wrapper.text()).toContain('Science')
    expect(wrapper.text()).toContain('+1')
    expect(wrapper.text()).toContain('EN')
    expect(wrapper.text()).toContain('Serial')
    expect(wrapper.text()).toContain('Updated')
    const website = wrapper.get('a[aria-label="Visit website"]')
    expect(website.attributes('href')).toBe('https://example.com/orbit')
    expect(website.attributes('rel')).toBe('noopener noreferrer')
  })

  it('keeps three visible actions plus the overflow and plays the recommendation directly', async () => {
    const wrapper = await mountView(
      show({
        playbackRecommendation: {
          episodeId: 42,
          title: 'Launch',
          positionSeconds: 120,
          durationSeconds: 600,
          kind: 'resume',
        },
      }),
      [episodeItem()],
    )

    const actions = wrapper.get('[data-testid="podcast-hero-actions"]')
    expect(actions.findAll('button')).toHaveLength(4)
    await actions
      .findAll('button')
      .find((button) => button.text().includes('Resume Launch'))!
      .trigger('click')

    expect(playerMocks.playInline).toHaveBeenCalledWith(42)
  })

  it('updates notification mode from the following menu', async () => {
    const wrapper = await mountView(show({ followed: true, notificationMode: 'off' }))
    apiMock.mockClear()

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Following'))!
      .trigger('click')
    await flushPromises()
    ;[...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((item) => item.textContent?.includes('Immediate'))?.click()
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/podcasts/12/follow',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ notificationMode: 'immediate' }) }),
    )
    wrapper.unmount()
  })

  it('starts episode playback inline without changing the route', async () => {
    const wrapper = await mountView(show(), [episodeItem()])
    routerMocks.push.mockClear()

    await wrapper.get('button[aria-label="Play Launch"]').trigger('click')

    expect(playerMocks.playInline).toHaveBeenCalledWith(42)
    expect(routerMocks.push).not.toHaveBeenCalled()
  })

  it('offers the delay only once post-listen cleanup is turned on, and saves both', async () => {
    const wrapper = await mountView(show())

    await clickShowAction(wrapper, 'podcast-open-settings')
    const settings = document.body.querySelector<HTMLElement>('[data-testid="podcast-settings-dialog"]')!
    const select = settings.querySelector<HTMLSelectElement>('[data-testid="podcast-download-cleanup"]')!

    expect(select.value).toBe('keep')
    expect(settings.querySelector('[data-testid="podcast-cleanup-delay"]')).toBeNull()

    select.value = 'after_finished'
    select.dispatchEvent(new Event('change'))
    await flushPromises()

    const delay = document.body.querySelector<HTMLInputElement>('[data-testid="podcast-cleanup-delay"]')!
    expect(settings.textContent).toContain('cancels the deletion')
    delay.value = '6'
    delay.dispatchEvent(new Event('input'))
    await flushPromises()

    apiMock.mockClear()
    document.body.querySelector<HTMLButtonElement>('[data-testid="podcast-save-settings"]')?.click()
    await flushPromises()

    const [, init] = apiMock.mock.calls.find(([url]) => String(url) === '/api/v1/podcasts/12/config')!
    expect(JSON.parse(String(init?.body))).toMatchObject({ downloadCleanup: 'after_finished', downloadCleanupDelayHours: 6 })
    wrapper.unmount()
  })

  it('drops the downloaded badge when the server evicts the file', async () => {
    const wrapper = await mountView(show(), [{ ...episodeItem(), mediaStatus: 'local', localSizeBytes: 2048 }])

    expect(wrapper.get('[data-testid="episode-status-row"]').text()).toContain('Downloaded')

    apiMock.mockClear()
    eventCallbacks.retentionEvicted?.({ libraryId: 7, podcastId: 12, episodeId: 42, reason: 'played' })
    await flushPromises()

    expect(wrapper.find('[data-testid="episode-status-row"]').exists() && wrapper.get('[data-testid="episode-status-row"]').text()).not.toContain(
      'Downloaded',
    )
    expect(apiMock).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('keeps destructive show actions out of the settings dialog', async () => {
    const wrapper = await mountView(show({ archivedAt: '2026-07-20T00:00:00.000Z' }))

    await clickShowAction(wrapper, 'podcast-open-settings')

    const settings = document.body.querySelector('[data-testid="podcast-settings-dialog"]')
    expect(settings?.textContent).toContain('Refresh interval in minutes')
    expect(settings?.textContent).not.toContain('Danger zone')
    expect(document.body.querySelector('[data-testid="podcast-manage-dialog"]')).toBeNull()

    const openManage = document.body.querySelector<HTMLElement>('[data-testid="podcast-open-manage"]')
    openManage?.click()
    await flushPromises()

    const manage = document.body.querySelector('[data-testid="podcast-manage-dialog"]')
    expect(manage?.textContent).toContain('Danger zone')
    expect(manage?.textContent).toContain('Merge duplicate show')
    expect(document.body.querySelector('[data-testid="podcast-settings-dialog"]')).toBeNull()
    wrapper.unmount()
  })

  it('deletes an unarchived show from one dialog, archiving on the way', async () => {
    const wrapper = await mountView(show())

    const manage = await openManageSheet(wrapper)
    apiMock.mockImplementationOnce(async () => jsonResponse({ files: 4, bytes: 2048 }))
    manage.querySelector<HTMLButtonElement>('[data-testid="podcast-delete"]')?.click()
    await flushPromises()

    const dialog = wrapper.findAllComponents(ConfirmDialog).find((item) => item.props('open'))
    expect(dialog?.props('description')).toContain('4 downloaded files')
    expect(dialog?.props('description')).toContain('4 episodes')

    apiMock.mockClear()
    dialog!.vm.$emit('confirm')
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcasts/12/archive', { method: 'POST' })
    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcasts/12/purge', { method: 'POST' })
    wrapper.unmount()
  })

  it('asks for the typed title only when the delete would remove downloaded files', async () => {
    const withDownloads = await mountView(show())
    let manage = await openManageSheet(withDownloads)
    apiMock.mockImplementationOnce(async () => jsonResponse({ files: 4, bytes: 2048 }))
    manage.querySelector<HTMLButtonElement>('[data-testid="podcast-delete"]')?.click()
    await flushPromises()

    expect(
      withDownloads
        .findAllComponents(ConfirmDialog)
        .find((item) => item.props('open'))
        ?.props('confirmationPhrase'),
    ).toBe('Orbit Radio')
    withDownloads.unmount()

    const withoutDownloads = await mountView(show({ archivedAt: '2026-07-20T00:00:00.000Z' }))
    manage = await openManageSheet(withoutDownloads)
    apiMock.mockImplementationOnce(async () => jsonResponse({ files: 0, bytes: 0 }))
    manage.querySelector<HTMLButtonElement>('[data-testid="podcast-delete"]')?.click()
    await flushPromises()

    const dialog = withoutDownloads.findAllComponents(ConfirmDialog).find((item) => item.props('open'))
    expect(dialog?.props('confirmationPhrase')).toBeUndefined()

    apiMock.mockClear()
    dialog!.vm.$emit('confirm')
    await flushPromises()

    // Already archived, so the delete goes straight to the purge the server requires.
    expect(apiMock).not.toHaveBeenCalledWith('/api/v1/podcasts/12/archive', { method: 'POST' })
    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcasts/12/purge', { method: 'POST' })
    withoutDownloads.unmount()
  })

  it('falls back to archiving, with copy explaining why, for a user who cannot purge', async () => {
    permissionMocks.denied.add(Permission.PodcastPurge)
    const wrapper = await mountView(show())

    const manage = await openManageSheet(wrapper)

    expect(manage.querySelector('[data-testid="podcast-delete"]')).toBeNull()
    expect(manage.querySelector('[data-testid="podcast-archive"]')).not.toBeNull()
    expect(manage.textContent).toContain('Only a library owner with permission to delete podcasts can remove it permanently.')
    wrapper.unmount()
  })

  it('offers every episode sort the list endpoint accepts', async () => {
    const wrapper = await mountView(show(), [episodeItem()])

    await wrapper.get('button[aria-label="Episode sort order"]').trigger('click')
    await flushPromises()

    const options = [...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      'Newest first',
      'Oldest first',
      'Shortest first',
      'Longest first',
      'Recently listened',
    ])

    routerMocks.replace.mockClear()
    options.find((option) => option.textContent?.includes('Shortest first'))?.click()
    await flushPromises()

    expect(routerMocks.replace).toHaveBeenCalledWith({
      query: { q: undefined, filter: undefined, sort: 'shortest', from: undefined, to: undefined },
    })
    wrapper.unmount()
  })

  it('calls the bounded show bulk-action endpoints', async () => {
    const wrapper = await mountView(show(), [episodeItem()])
    apiMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/queue-all')) return jsonResponse({ completed: 1, failed: 0, skipped: 0, firstEpisodeId: 42 })
      if (url.endsWith('/mark-all-played')) return jsonResponse({ completed: 1, failed: 0, skipped: 0 })
      if (url.endsWith('/download-latest'))
        return jsonResponse({ completed: 1, failed: 0, skipped: 0, batchId: '0f31ea6f-03f0-4e3d-ae5c-1467ae7ec115' })
      if (url.endsWith('/downloads')) return jsonResponse({ completed: 1, failed: 0, skipped: 0 })
      if (url === '/api/v1/podcasts/12') return jsonResponse(show())
      if (url.includes('/episodes')) return jsonResponse({ items: [episodeItem()], total: 1, page: 1, size: 100 })
      return new Response(null, { status: 204 })
    })
    apiMock.mockClear()

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Play all'))!
      .trigger('click')
    await flushPromises()
    expect(playerMocks.playInline).toHaveBeenCalledWith(42)

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Queue all'))!
      .trigger('click')
    await flushPromises()
    await clickShowAction(wrapper, 'podcast-mark-all-played')
    await flushPromises()

    await openShowActions(wrapper)
    document.body.querySelector<HTMLElement>('[data-testid="podcast-download-latest"]')?.click()
    await flushPromises()
    document.body.querySelector<HTMLElement>('[data-testid="podcast-download-latest-10"]')?.click()
    await flushPromises()

    await clickShowAction(wrapper, 'podcast-remove-all-downloads')
    wrapper.findComponent(ConfirmDialog).vm.$emit('confirm')
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcasts/12/queue-all', { method: 'POST' })
    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcasts/12/mark-all-played', { method: 'POST' })
    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/podcasts/12/download-latest',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ count: 10 }) }),
    )
    expect(downloadBatchMocks.track).toHaveBeenCalledWith('0f31ea6f-03f0-4e3d-ae5c-1467ae7ec115')
    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcasts/12/downloads', { method: 'DELETE' })
  })

  it('debounces typed episode search instead of requiring a submit', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const wrapper = await mountView(show(), [episodeItem()])
      routerMocks.replace.mockClear()

      await wrapper.get('input[type="search"]').setValue('launch')
      expect(routerMocks.replace).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(300)

      expect(routerMocks.replace).toHaveBeenCalledWith({
        query: { q: 'launch', filter: undefined, sort: undefined, from: undefined, to: undefined },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('applies an episode search immediately when the form is submitted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const wrapper = await mountView(show(), [episodeItem()])
      routerMocks.replace.mockClear()

      await wrapper.get('input[type="search"]').setValue('launch')
      await wrapper.get('form[role="search"]').trigger('submit')
      await flushPromises()

      expect(routerMocks.replace).toHaveBeenCalledOnce()

      // The pending debounce was cancelled by the submit, so it does not re-apply the same query.
      await vi.advanceTimersByTimeAsync(300)
      expect(routerMocks.replace).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('hydrates the sticky chip toolbar from a deep link', async () => {
    const wrapper = await mountView(show(), [episodeItem()], {
      q: 'launch',
      filter: 'downloaded',
      sort: 'oldest',
      from: '2026-03-01',
      to: '2026-04-15',
    })

    expect(wrapper.get('form[role="search"]').classes()).toContain('sticky')
    expect((wrapper.get('input[type="search"]').element as HTMLInputElement).value).toBe('launch')
    expect(
      wrapper
        .get('[role="group"][aria-label="Episode filters"]')
        .findAll('button')
        .find((button) => button.text() === 'Downloaded')
        ?.attributes('aria-pressed'),
    ).toBe('true')
    expect(wrapper.get('button[aria-label="Episode sort order"]').text()).toContain('Oldest first')
    expect(wrapper.get('button[aria-label="Episode publication dates"]').text()).toContain('Mar 1 - Apr 15')
    expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('publishedFrom=2026-03-01'))
    expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('publishedTo=2026-04-15'))
  })

  it('renders season headers only when loaded episodes span multiple seasons', async () => {
    const secondSeason = { ...episodeItem(), id: 43, title: 'Return', season: '2' }
    const wrapper = await mountView(show(), [episodeItem(), secondSeason])

    expect(wrapper.text()).toContain('Season 1')
    expect(wrapper.text()).toContain('Season 2')
  })

  it('supports the pinned episode filter and its retention empty state', async () => {
    const wrapper = await mountView(show(), [], { filter: 'pinned' })

    expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('filter=pinned'))
    expect(wrapper.text()).toContain('Pinned')
    expect(wrapper.text()).toContain('Pinned episodes are protected from storage retention removal.')
  })

  it('opens the details editor and folds the saved values back into the hero', async () => {
    const wrapper = await mountView(show())

    await clickShowAction(wrapper, 'podcast-open-edit-details')
    const sheet = wrapper.findComponent(PodcastEditDetailsSheet)
    expect(sheet.props('open')).toBe(true)

    sheet.vm.$emit('saved', {
      id: 12,
      title: 'Orbit Radio Reloaded',
      author: 'Orbit Studios',
      description: null,
      siteUrl: null,
      language: 'de',
      explicit: true,
      categories: ['Science', 'Technology'],
      lockedFields: ['title', 'author'],
    })
    sheet.vm.$emit('artwork-changed', { id: 12, imageUrl: '/api/v1/podcasts/12/artwork?v=99', artworkUpdatedAt: '2026-07-31T00:00:00.000Z' })
    await flushPromises()

    expect(wrapper.get('h1').text()).toBe('Orbit Radio Reloaded')
    expect(wrapper.text()).toContain('Orbit Studios')
    expect(wrapper.text()).toContain('Technology')
    expect(wrapper.get('img').attributes('src')).toBe('/api/v1/podcasts/12/artwork?v=99')
  })

  describe('local shows', () => {
    it('marks the show as local and offers nothing that needs a feed', async () => {
      const wrapper = await mountView(show({ origin: 'local', lastRefreshSuccessAt: '2026-07-30T00:00:00.000Z' }), [episodeItem()])

      expect(wrapper.get('[data-testid="podcast-local-origin-badge"]').text()).toContain('Local')
      expect(wrapper.text()).not.toContain('Checks every')

      await openShowActions(wrapper)
      expect(document.body.querySelector('[data-testid="podcast-download-latest"]')).toBeNull()
      expect(document.body.querySelector('[data-testid="podcast-remove-all-downloads"]')).toBeNull()
      expect(document.body.textContent).not.toContain('Refresh feed')
    })

    it('hides the feed failure banner, which describes a feed a local show does not have', async () => {
      const wrapper = await mountView(show({ origin: 'local', consecutiveFailures: 5 }))

      expect(wrapper.find('[data-testid="podcast-feed-failure-banner"]').exists()).toBe(false)
    })

    it('saves cleanup without the refresh cadence a local show cannot use', async () => {
      const wrapper = await mountView(show({ origin: 'local' }))
      await clickShowAction(wrapper, 'podcast-open-settings')
      expect(document.body.querySelector('[data-testid="podcast-download-cleanup"]')).not.toBeNull()
      apiMock.mockClear()
      apiMock.mockResolvedValue(new Response(null, { status: 204 }))

      document.body.querySelector<HTMLElement>('[data-testid="podcast-save-settings"]')?.click()
      await flushPromises()

      expect(apiMock).toHaveBeenCalledWith(
        '/api/v1/podcasts/12/config',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ downloadCleanup: 'keep' }) }),
      )
    })

    it('never deletes a local episode file, which belongs to the user rather than to BookOrbit', async () => {
      const wrapper = await mountView(show({ origin: 'local' }), [{ ...episodeItem(), origin: 'local', mediaStatus: 'local', localSizeBytes: 2048 }])
      const row = wrapper.findComponent(PodcastEpisodeRow)
      apiMock.mockClear()

      row.vm.$emit('remove-download', { ...episodeItem(), origin: 'local', mediaStatus: 'local' })
      await flushPromises()

      expect(apiMock).not.toHaveBeenCalled()
    })

    it('does not offer the remove action on a local episode row at all', async () => {
      const wrapper = await mountView(show({ origin: 'local' }), [{ ...episodeItem(), origin: 'local', mediaStatus: 'local', localSizeBytes: 2048 }])

      expect(wrapper.findComponent(PodcastEpisodeRow).text()).not.toContain('Remove download')
    })
  })
})

function episodeItem(): PodcastEpisodeListItem {
  return {
    id: 42,
    libraryId: 7,
    origin: 'feed',
    podcastId: 12,
    podcastTitle: 'Orbit Radio',
    podcastImageUrl: null,
    title: 'Launch',
    season: '1',
    episode: '1',
    explicit: false,
    inFeed: true,
    publishedAt: '2026-07-29T00:00:00.000Z',
    durationSeconds: 600,
    audioFormat: null,
    mediaStatus: 'remote',
    localSizeBytes: null,
    checksum: null,
    positionSeconds: 0,
    progressPercent: 0,
    finished: false,
    pinned: false,
    queued: false,
    lastListenedAt: null,
  }
}
