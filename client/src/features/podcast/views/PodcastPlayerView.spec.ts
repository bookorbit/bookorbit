import { reactive, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PodcastChapter, PodcastEpisodeSummary } from '@bookorbit/types'
import PodcastPlayerView from './PodcastPlayerView.vue'

const route = vi.hoisted(() => ({ params: { episodeId: '42' }, query: {} as Record<string, string> }))
const routerMocks = vi.hoisted(() => ({
  push: vi.fn<() => void>(),
  replace: vi.fn<() => Promise<void>>(async () => undefined),
  back: vi.fn<() => void>(),
}))
const player = await vi.hoisted(async () => {
  const { createPlayerStub } = await import('../test/stubs')
  return createPlayerStub()
})

vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => routerMocks }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() } }))
vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true, isSuperuser: ref(true) }),
}))
vi.mock('../components/PodcastBookmarksPanel.vue', () => ({ default: { name: 'PodcastBookmarksPanel', template: '<div />' } }))
vi.mock('../composables/usePodcastPlayer', () => ({ usePodcastPlayer: () => player }))

const chapters: PodcastChapter[] = [
  { title: 'Intro', startSeconds: 0 },
  { title: 'Interview', startSeconds: 150 },
  { title: 'Outro', startSeconds: 450 },
]

async function mountView() {
  route.query = reactive({}) as Record<string, string>
  const wrapper = mount(PodcastPlayerView, {
    attachTo: document.body,
    global: {
      stubs: {
        Tooltip: { template: '<div><slot /></div>' },
        TooltipTrigger: { template: '<slot />' },
        TooltipContent: { template: '<div><slot /></div>' },
        DropdownMenu: { template: '<div><slot /></div>' },
        DropdownMenuTrigger: { template: '<slot />' },
        DropdownMenuContent: { template: '<div data-testid="dropdown-content"><slot /></div>' },
        DropdownMenuItem: { template: '<button type="button"><slot /></button>' },
        DropdownMenuSeparator: { template: '<div />' },
      },
    },
  })
  await flushPromises()
  return wrapper
}

describe('PodcastPlayerView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    route.params = { episodeId: '42' }
    player.episode.value = episode()
    player.bookmarks.value = []
    player.currentTime.value = 0
    player.duration.value = 600
    player.activeChapterIndex.value = 0
    player.sleepRemainingSeconds.value = null
  })

  it('does not ask the shared player for an episode once the route param is gone', async () => {
    const params = reactive<{ episodeId?: string }>({ episodeId: '42' })
    route.params = params as { episodeId: string }
    const wrapper = await mountView()
    vi.mocked(player.loadEpisode).mockClear()

    // Leaving the route drops the param while this view is still mounted.
    delete params.episodeId
    await flushPromises()

    expect(vi.mocked(player.loadEpisode)).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('marks chapter boundaries on the scrubber without a marker at either end', async () => {
    const wrapper = await mountView()

    const markers = wrapper.findAll('[data-testid="media-scrubber-marker"][data-kind="chapter"]')

    expect(markers).toHaveLength(2)
    expect(markers[0]!.attributes('style')).toContain('left: 25%')
    expect(markers[1]!.attributes('style')).toContain('left: 75%')
    wrapper.unmount()
  })

  it('names the active chapter for the scrubber so the markers are not visual only', async () => {
    player.activeChapterIndex.value = 1
    const wrapper = await mountView()

    expect(wrapper.get('[role="slider"][aria-label="Episode position"]').attributes('aria-valuetext')).toBe(
      '0:00 elapsed of 10:00, chapter Interview',
    )
    wrapper.unmount()
  })

  it('scrolls the chapter panel to the active chapter without moving the page', async () => {
    const wrapper = await mountView()
    const list = wrapper.get('[data-chapter-index="0"]').element.parentElement as HTMLElement
    const scrollTo = vi.fn<(options: ScrollToOptions) => void>()
    list.scrollTo = scrollTo as unknown as HTMLElement['scrollTo']
    Object.defineProperty(list, 'clientHeight', { value: 40, configurable: true })
    const target = wrapper.get('[data-chapter-index="2"]').element as HTMLElement
    Object.defineProperty(target, 'offsetTop', { value: 200, configurable: true })
    Object.defineProperty(target, 'offsetHeight', { value: 20, configurable: true })

    player.activeChapterIndex.value = 2
    await flushPromises()

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 180 }))
    wrapper.unmount()
  })

  it('offers to extend a running sleep timer and announces the remaining time', async () => {
    player.sleepRemainingSeconds.value = 240
    const wrapper = await mountView()

    const remaining = wrapper.get('[data-testid="podcast-sleep-remaining"]')
    expect(remaining.attributes('role')).toBe('status')
    expect(remaining.text()).toBe('4m')

    await wrapper.get('button[aria-label="Sleep timer"]').trigger('click')
    await flushPromises()
    ;(document.querySelector('button[aria-label="Add 5 more minutes to the sleep timer"]') as HTMLButtonElement).click()

    expect(vi.mocked(player.extendSleepTimer)).toHaveBeenCalledWith(5)
    wrapper.unmount()
  })

  it('hides the extend control when no countdown is running', async () => {
    const wrapper = await mountView()

    expect(wrapper.find('[data-testid="podcast-sleep-remaining"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('toggles pinned state from the episode actions menu', async () => {
    const wrapper = await mountView()

    const pin = wrapper.findAll('button').find((button) => button.text() === 'Pin')
    expect(pin).toBeDefined()
    await pin!.trigger('click')

    expect(vi.mocked(player.togglePinned)).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('keeps destructive restart in the overflow menu, not the primary action row', async () => {
    player.currentTime.value = 120
    const wrapper = await mountView()

    const row = wrapper.get('[data-testid="podcast-episode-actions"]')
    const menu = row.get('[data-testid="dropdown-content"]')
    expect(row.text()).toContain('Mark played')
    expect(menu.text()).toContain('Restart')
    expect(menu.text()).not.toContain('Mark played')
    wrapper.unmount()
  })

  it('persists the selected time display', async () => {
    const wrapper = await mountView()
    const toggle = wrapper.get('button[aria-label="Toggle remaining and total time"]')

    expect(toggle.text()).toBe('-10:00')
    await toggle.trigger('click')

    expect(toggle.text()).toBe('10:00')
    expect(localStorage.getItem('bookorbit:podcast-time-display')).toBe('total')
    wrapper.unmount()
  })

  it('renders episode identity details and bookmark markers', async () => {
    player.episode.value = { ...episode(), subtitle: 'A closer look', season: '2', episode: '4', episodeType: 'bonus' }
    player.bookmarks.value = [
      {
        id: 1,
        episodeId: 42,
        positionSeconds: 90,
        title: 'Key idea',
        note: null,
        createdAt: '2026-07-10T00:00:00.000Z',
        updatedAt: '2026-07-10T00:00:00.000Z',
      },
    ]
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('A closer look')
    expect(wrapper.text()).toContain('S2 E4')
    expect(wrapper.text()).toContain('Bonus')
    expect(wrapper.findAll('[data-testid="media-scrubber-marker"][data-kind="bookmark"]')).toHaveLength(1)
    wrapper.unmount()
  })

  it('places the description before the sidebar in mobile reading order', async () => {
    player.episode.value = { ...episode(), description: 'About '.repeat(60) }
    const wrapper = await mountView()
    const text = wrapper.text()

    expect(text.indexOf('About this episode')).toBeLessThan(text.indexOf('Up next'))
    wrapper.unmount()
  })

  it('shows chapter duration and links without nesting the link in the seek control', async () => {
    player.episode.value = {
      ...episode(),
      chapters: [
        { title: 'Intro', startSeconds: 0, endSeconds: 90, url: 'https://example.com/intro' },
        { title: 'Interview', startSeconds: 90 },
      ],
    }
    const wrapper = await mountView()

    expect(wrapper.get('[data-chapter-index="0"]').text()).toContain('1:30')
    const link = wrapper.get('a[aria-label="Open chapter link for Intro"]')
    expect(link.attributes('href')).toBe('https://example.com/intro')
    expect(link.element.closest('button')).toBeNull()
    wrapper.unmount()
  })
})

function episode(): PodcastEpisodeSummary {
  return {
    id: 42,
    libraryId: 2,
    origin: 'feed',
    podcastId: 3,
    podcastTitle: 'Orbit Radio',
    podcastImageUrl: null,
    title: 'Launch',
    subtitle: null,
    description: null,
    publishedAt: '2026-07-29T00:00:00.000Z',
    season: null,
    episode: null,
    episodeType: null,
    durationSeconds: 600,
    audioFormat: 'mp3',
    explicit: false,
    chapters,
    transcripts: [],
    lockedFields: [],
    inFeed: true,
    mediaStatus: 'remote',
    localSizeBytes: null,
    checksum: null,
    positionSeconds: 0,
    progressPercent: 0,
    finished: false,
    pinned: false,
    queued: false,
    lastListenedAt: null,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
  }
}
