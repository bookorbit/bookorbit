import { computed, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PodcastQueueItem } from '@bookorbit/types'
import MediaVolumeControl from '@/components/media/MediaVolumeControl.vue'
import { makeEpisodeSummary } from '../test/fixtures'
import { createPlayerStub } from '../test/stubs'
import PodcastMiniPlayer from './PodcastMiniPlayer.vue'

const routerMocks = vi.hoisted(() => ({
  push: vi.fn<(route: unknown) => void>(),
  route: { name: 'podcast-library' },
}))
const toastMocks = vi.hoisted(() => ({
  success: vi.fn<(message: string, options?: unknown) => void>(),
  error: vi.fn<(message: string) => void>(),
}))
const mockUsePodcastPlayer = vi.hoisted(() => vi.fn<() => unknown>())

vi.mock('vue-router', () => ({
  useRoute: () => routerMocks.route,
  useRouter: () => ({ push: routerMocks.push }),
}))

vi.mock('../composables/usePodcastPlayer', () => ({
  usePodcastPlayer: mockUsePodcastPlayer,
}))

vi.mock('vue-sonner', () => ({
  toast: toastMocks,
}))

describe('PodcastMiniPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    routerMocks.route.name = 'podcast-library'
    stubViewport(false)
    mockUsePodcastPlayer.mockReturnValue(createPlayer())
  })

  it('stays hidden without an active episode or on the full player route', () => {
    const player = createPlayer()
    player.episode.value = null
    mockUsePodcastPlayer.mockReturnValue(player)

    const withoutEpisode = mount(PodcastMiniPlayer)
    expect(withoutEpisode.find('section').exists()).toBe(false)

    routerMocks.route.name = 'podcast-player'
    player.episode.value = createEpisode()
    const onPlayerRoute = mount(PodcastMiniPlayer)
    expect(onPlayerRoute.find('section').exists()).toBe(false)
  })

  it('provides shared playback, seeking and volume controls in expanded mode', async () => {
    const player = createPlayer()
    mockUsePodcastPlayer.mockReturnValue(player)
    const wrapper = mount(PodcastMiniPlayer)

    expect(wrapper.find('[data-testid="podcast-expanded-mini-player"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('The Long Orbit')
    expect(wrapper.text()).toContain('10:00')
    expect(wrapper.text()).toContain('-50:00')

    await wrapper.get('button[aria-label="Back 15 seconds"]').trigger('click')
    await wrapper.get('button[aria-label="Play"]').trigger('click')
    await wrapper.get('button[aria-label="Forward 30 seconds"]').trigger('click')
    await wrapper.get('button[aria-label="Previous episode"]').trigger('click')
    await wrapper.get('button[aria-label="Next episode"]').trigger('click')
    await wrapper.get('[role="slider"][aria-label="Episode position"]').trigger('keydown', { key: 'ArrowRight' })

    const volumeControl = wrapper.getComponent(MediaVolumeControl)
    volumeControl.vm.$emit('update:volume', 0.4)
    volumeControl.vm.$emit('toggleMute')

    expect(player.skipBackward).toHaveBeenCalledOnce()
    expect(player.togglePlayback).toHaveBeenCalledOnce()
    expect(player.skipForward).toHaveBeenCalledOnce()
    expect(player.playPrevious).toHaveBeenCalledOnce()
    expect(player.playNext).toHaveBeenCalledOnce()
    expect(player.seekTo).toHaveBeenCalledExactlyOnceWith(605)
    expect(player.setVolume).toHaveBeenCalledWith(0.4)
    expect(player.toggleMute).toHaveBeenCalledOnce()
  })

  it('disables unavailable episode navigation in expanded mode', () => {
    const player = createPlayer()
    player.previousQueueItem.value = null
    player.nextQueueItem.value = null
    mockUsePodcastPlayer.mockReturnValue(player)

    const wrapper = mount(PodcastMiniPlayer)

    expect(wrapper.get('button[aria-label="Previous episode"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('button[aria-label="Next episode"]').attributes('disabled')).toBeDefined()
  })

  it('collapses without stopping playback and persists the selected mode', async () => {
    const player = createPlayer()
    mockUsePodcastPlayer.mockReturnValue(player)
    const wrapper = mount(PodcastMiniPlayer)

    await wrapper.get('button[aria-label="Collapse to compact player"]').trigger('click')

    expect(wrapper.find('[data-testid="podcast-super-mini-player"]').exists()).toBe(true)
    expect(localStorage.getItem('bookorbit:podcast-mini-player-mode')).toBe('compact')
    expect(player.clearPlayer).not.toHaveBeenCalled()

    await wrapper.get('button[aria-label="Expand mini player"]').trigger('click')

    expect(wrapper.find('[data-testid="podcast-expanded-mini-player"]').exists()).toBe(true)
    expect(localStorage.getItem('bookorbit:podcast-mini-player-mode')).toBe('expanded')
  })

  it('restores a persisted super-mini preference', () => {
    localStorage.setItem('bookorbit:podcast-mini-player-mode', 'compact')

    const wrapper = mount(PodcastMiniPlayer)

    expect(wrapper.find('[data-testid="podcast-super-mini-player"]').exists()).toBe(true)
  })

  it('defaults to super-mini mode on narrow screens', () => {
    stubViewport(true)

    const wrapper = mount(PodcastMiniPlayer)

    expect(wrapper.find('[data-testid="podcast-super-mini-player"]').exists()).toBe(true)
  })

  it('opens the full player from the super-mini episode button', async () => {
    localStorage.setItem('bookorbit:podcast-mini-player-mode', 'compact')
    const wrapper = mount(PodcastMiniPlayer)

    await wrapper.findAll('button[aria-label="Open full player"]')[1]!.trigger('click')

    expect(routerMocks.push).toHaveBeenCalledWith({ name: 'podcast-player', params: { episodeId: 665 } })
  })

  it('opens the full player from the explicit expanded control', async () => {
    const wrapper = mount(PodcastMiniPlayer)

    await wrapper.findAll('button[aria-label="Open full player"]').at(-1)!.trigger('click')

    expect(routerMocks.push).toHaveBeenCalledWith({ name: 'podcast-player', params: { episodeId: 665 } })
  })

  it('cycles playback rate from the expanded control', async () => {
    const player = createPlayer()
    player.playbackRate.value = 1.25
    mockUsePodcastPlayer.mockReturnValue(player)
    const wrapper = mount(PodcastMiniPlayer)

    expect(wrapper.get('button[aria-label="Cycle playback speed"]').text()).toBe('1.25x')
    await wrapper.get('button[aria-label="Cycle playback speed"]').trigger('click')

    expect(player.cyclePlaybackRate).toHaveBeenCalledOnce()
  })

  it('shows an active sleep timer with extend and turn-off controls', async () => {
    const player = createPlayer()
    player.sleepTimerMinutes.value = 15
    player.sleepRemainingSeconds.value = 720
    mockUsePodcastPlayer.mockReturnValue(player)
    const popoverStub = { template: '<div><slot /></div>' }
    const wrapper = mount(PodcastMiniPlayer, {
      global: {
        stubs: {
          Popover: popoverStub,
          PopoverTrigger: popoverStub,
          PopoverContent: popoverStub,
        },
      },
    })

    expect(wrapper.get('button[aria-label="Sleep timer active: 12 min"]').text()).toContain('12 min')
    await wrapper.get('button[aria-label="Add 5 more minutes to the sleep timer"]').trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Off')!
      .trigger('click')

    expect(player.extendSleepTimer).toHaveBeenCalledWith(5)
    expect(player.clearSleepTimer).toHaveBeenCalledOnce()
  })

  it('offers an undo action after stopping and closing the player', async () => {
    const player = createPlayer()
    mockUsePodcastPlayer.mockReturnValue(player)
    const wrapper = mount(PodcastMiniPlayer)

    await wrapper.get('button[aria-label="Stop and close player"]').trigger('click')

    expect(player.clearPlayer).toHaveBeenCalledOnce()
    expect(localStorage.getItem('bookorbit:podcast-mini-player-mode')).toBeNull()
    expect(toastMocks.success).toHaveBeenCalledWith('Player closed', expect.any(Object))

    const options = toastMocks.success.mock.calls[0]![1] as { action: { label: string; onClick: () => void } }
    expect(options.action.label).toBe('Undo')
    options.action.onClick()
    expect(player.loadEpisode).toHaveBeenCalledWith(665, false)
  })

  it('shows pending playback and buffered progress in compact mode', () => {
    localStorage.setItem('bookorbit:podcast-mini-player-mode', 'compact')
    const player = createPlayer()
    player.isBuffering.value = true
    player.bufferedRanges.value = [{ start: 0, end: 1_200 }]
    mockUsePodcastPlayer.mockReturnValue(player)
    const wrapper = mount(PodcastMiniPlayer)

    expect(wrapper.get('button[aria-label="Play"] svg').classes()).toContain('animate-spin')
    expect(wrapper.get('[data-testid="podcast-mini-player-buffered"]').attributes('style')).toContain('width: 33.3333')
  })

  it('shows playback errors with retry in compact mode', async () => {
    localStorage.setItem('bookorbit:podcast-mini-player-mode', 'compact')
    const player = createPlayer()
    player.error.value = 'The episode could not be loaded.'
    mockUsePodcastPlayer.mockReturnValue(player)
    const wrapper = mount(PodcastMiniPlayer)

    expect(wrapper.get('[role="alert"]').text()).toContain('The episode could not be loaded.')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Retry')!
      .trigger('click')

    expect(player.playInline).toHaveBeenCalledWith(665)
  })
})

/** jsdom has no matchMedia, and useMediaQuery subscribes to the returned list, so the stub needs listeners. */
function stubViewport(matchesCompact: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn<(query: string) => Partial<MediaQueryList>>().mockReturnValue({
      matches: matchesCompact,
      addEventListener: vi.fn<() => void>(),
      removeEventListener: vi.fn<() => void>(),
    }),
  )
}

function createEpisode() {
  return makeEpisodeSummary({
    id: 665,
    podcastId: 12,
    podcastTitle: 'The Long Orbit',
    title: 'A Better Mini Player',
    podcastImageUrl: 'https://feed.example/cover.jpg',
    durationSeconds: 3_600,
  })
}

function createPlayer() {
  const duration = ref(3_600)
  const currentTime = ref(600)
  return createPlayerStub({
    episode: ref(createEpisode()),
    duration,
    currentTime,
    progressPercent: computed(() => (currentTime.value / duration.value) * 100),
    previousQueueItem: ref({ id: 664 } as PodcastQueueItem),
    nextQueueItem: ref({ id: 666 } as PodcastQueueItem),
  })
}
