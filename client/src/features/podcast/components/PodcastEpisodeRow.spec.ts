import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { PodcastEpisodeListItem } from '@bookorbit/types'
import PodcastEpisodeRow from './PodcastEpisodeRow.vue'
import { createPodcastEpisodeActionsStub, provideEpisodeActions } from '../test/episode-action-stubs'

describe('PodcastEpisodeRow', () => {
  it('highlights and labels the actively playing episode', () => {
    const wrapper = mountRow({ isActive: true, isPlaying: true })

    expect(wrapper.get('article').attributes('aria-current')).toBe('true')
    expect(wrapper.get('article').classes()).toContain('border-primary/50')
    expect(wrapper.text()).toContain('Now playing')
  })

  it('keeps the active episode identifiable while playback is paused', () => {
    const wrapper = mountRow({ isActive: true, isPlaying: false })

    expect(wrapper.get('article').attributes('aria-current')).toBe('true')
    expect(wrapper.get('article').classes()).toContain('bg-muted/30')
    expect(wrapper.text()).toContain('Paused')
    expect(wrapper.text()).not.toContain('Now playing')
  })

  it('does not add playback state to inactive episodes', () => {
    const wrapper = mountRow()

    expect(wrapper.get('article').attributes('aria-current')).toBeUndefined()
    expect(wrapper.get('article').classes()).toContain('border-border/60')
    expect(wrapper.text()).not.toContain('Now playing')
    expect(wrapper.text()).not.toContain('Paused')
  })

  it('names every play control with the episode it starts', () => {
    const wrapper = mountRow()

    const labels = wrapper.findAll('button').map((button) => button.attributes('aria-label'))

    expect(labels).toContain('Play A Better Episode Row')
    expect(labels).toContain('Listen to A Better Episode Row')
    expect(labels).not.toContain('Play episode')
  })

  it('falls back to the placeholder when artwork fails to load', async () => {
    const wrapper = mountRow()

    expect(wrapper.get('img').attributes('src')).toBe('/api/v1/podcasts/12/artwork')

    await wrapper.get('img').trigger('error')

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('svg').exists()).toBe(true)
  })

  it('uses semantic colors for media status', () => {
    const downloaded = mountRow()
    const queued = mountRow({}, { mediaStatus: 'queued' })
    const downloading = mountRow({}, { mediaStatus: 'downloading' })
    const failed = mountRow({}, { mediaStatus: 'failed' })
    const unavailable = mountRow({}, { mediaStatus: 'unavailable' })

    expect(findTextElement(downloaded, 'Downloaded').classes()).toContain('text-success')
    expect(downloaded.find('[data-testid="podcast-status-icon"]').exists()).toBe(true)
    expect(findTextElement(queued, 'Download queued').classes()).toContain('text-warning')
    expect(queued.find('[data-testid="podcast-status-icon"]').exists()).toBe(true)
    expect(findTextElement(downloading, 'Downloading').classes()).toContain('text-info')
    expect(downloading.find('[data-testid="podcast-status-icon"]').exists()).toBe(true)
    expect(findTextElement(failed, 'Download failed').classes()).toContain('text-destructive')
    expect(failed.find('[data-testid="podcast-status-icon"]').exists()).toBe(true)
    expect(findTextElement(unavailable, 'Unavailable').classes()).toContain('text-destructive')
    expect(unavailable.find('[data-testid="podcast-status-icon"]').exists()).toBe(true)
  })

  it('shows episode numbering, explicit status, feed removal, and download progress', () => {
    const wrapper = mount(PodcastEpisodeRow, {
      props: {
        episode: {
          ...createEpisode(),
          season: '2',
          episode: '14',
          explicit: true,
          inFeed: false,
          mediaStatus: 'downloading',
        },
        canDownload: true,
        downloadProgress: { receivedBytes: 25, totalBytes: 100 },
      },
    })

    expect(wrapper.text()).toContain('S2 E14')
    expect(wrapper.get('[aria-label="Explicit"]').text()).toBe('E')
    expect(wrapper.text()).toContain('No longer in feed')
    expect(wrapper.get('[aria-label="Download progress"]').attributes('aria-valuenow')).toBe('25')
  })

  it('wraps status chips separately from truncated identity metadata', () => {
    const wrapper = mountRow({}, { inFeed: false, finished: true, queued: true })

    expect(wrapper.get('[data-testid="episode-status-row"]').classes()).toContain('flex-wrap')
    expect(wrapper.get('[data-testid="episode-status-row"]').text()).toContain('Downloaded')
    expect(wrapper.get('[data-testid="episode-status-row"]').text()).toContain('Played')
    expect(wrapper.get('[data-testid="episode-status-row"]').text()).toContain('No longer in feed')
    expect(wrapper.get('[data-testid="episode-status-row"]').text()).toContain('In queue')
  })

  it('shows formatted time remaining beside playback progress', () => {
    const wrapper = mountRow({}, { durationSeconds: 4_200, positionSeconds: 600, progressPercent: 14.29 })

    expect(wrapper.text()).toContain('1h 0m left')
    expect(wrapper.get('[aria-label="Playback progress"]').attributes('aria-valuenow')).toBe('14')
  })

  it('opens episode details from the title', async () => {
    const actions = createPodcastEpisodeActionsStub()
    const wrapper = mountRow({}, {}, actions)

    await wrapper.get('button[aria-label="Episode details for A Better Episode Row"]').trigger('click')

    expect(actions.openDetails).toHaveBeenCalledWith(expect.objectContaining({ id: 665 }))
  })

  it('offers play from here in queue row actions', async () => {
    const actions = createPodcastEpisodeActionsStub()
    const wrapper = mountRow({ queueControls: true }, {}, actions)

    await wrapper.get('button[aria-label="Episode actions"]').trigger('click')
    await flushPromises()
    const action = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((item) =>
      item.textContent?.includes('Play from here'),
    )
    action?.click()
    await flushPromises()

    expect(actions.play).toHaveBeenCalledWith(expect.objectContaining({ id: 665 }))
    wrapper.unmount()
  })

  it('offers metadata editing only to a caller that may edit it', async () => {
    const withoutPermission = mountRow()
    await withoutPermission.get('button[aria-label="Episode actions"]').trigger('click')
    await flushPromises()
    expect(document.body.querySelector('[data-testid="podcast-edit-episode-metadata"]')).toBeNull()
    withoutPermission.unmount()

    const actions = createPodcastEpisodeActionsStub()
    const wrapper = mountRow({ canEditMetadata: true }, {}, actions)
    await wrapper.get('button[aria-label="Episode actions"]').trigger('click')
    await flushPromises()
    document.body.querySelector<HTMLElement>('[data-testid="podcast-edit-episode-metadata"]')?.click()
    await flushPromises()

    expect(actions.openMetadataEditor).toHaveBeenCalledWith(expect.objectContaining({ id: 665 }))
    wrapper.unmount()
  })

  it('shows pinned state and offers pinning actions with the retention hint', async () => {
    const unpinnedActions = createPodcastEpisodeActionsStub()
    const unpinned = mountRow({}, {}, unpinnedActions)
    await unpinned.get('button[aria-label="Episode actions"]').trigger('click')
    await flushPromises()
    const pinAction = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((item) =>
      item.textContent?.includes('Pin episode'),
    )
    expect(pinAction?.title).toBe('Pinned episodes are protected from storage retention removal.')
    pinAction?.click()
    await flushPromises()
    expect(unpinnedActions.pin).toHaveBeenCalledWith(expect.objectContaining({ id: 665 }))
    unpinned.unmount()

    const pinnedActions = createPodcastEpisodeActionsStub()
    const pinned = mountRow({}, { pinned: true }, pinnedActions)
    expect(pinned.text()).toContain('Pinned episode')
    await pinned.get('button[aria-label="Episode actions"]').trigger('click')
    await flushPromises()
    const unpinAction = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((item) =>
      item.textContent?.includes('Unpin episode'),
    )
    unpinAction?.click()
    await flushPromises()
    expect(pinnedActions.unpin).toHaveBeenCalledWith(expect.objectContaining({ id: 665 }))
    pinned.unmount()
  })
})

function mountRow(
  playback: { isActive?: boolean; isPlaying?: boolean; queueControls?: boolean; canEditMetadata?: boolean } = {},
  episode: Partial<PodcastEpisodeListItem> = {},
  actions = createPodcastEpisodeActionsStub(),
) {
  return mount(PodcastEpisodeRow, {
    props: {
      episode: { ...createEpisode(), ...episode },
      canDownload: true,
      ...playback,
    },
    global: { provide: provideEpisodeActions(actions) },
  })
}

function findTextElement(wrapper: ReturnType<typeof mountRow>, text: string) {
  const element = wrapper.findAll('span').find((candidate) => candidate.text() === text)
  if (!element) throw new Error(`Missing element with text: ${text}`)
  return element
}

function createEpisode(): PodcastEpisodeListItem {
  return {
    id: 665,
    libraryId: 2,
    origin: 'feed',
    podcastId: 12,
    podcastTitle: 'The Long Orbit',
    podcastImageUrl: '/api/v1/podcasts/12/artwork',
    title: 'A Better Episode Row',
    season: null,
    episode: null,
    explicit: false,
    inFeed: true,
    publishedAt: '2026-07-11T12:00:00.000Z',
    durationSeconds: 3_600,
    audioFormat: null,
    mediaStatus: 'local',
    localSizeBytes: 42_000_000,
    checksum: 'a'.repeat(64),
    positionSeconds: 600,
    progressPercent: 16.67,
    finished: false,
    pinned: false,
    queued: true,
    lastListenedAt: '2026-07-11T12:10:00.000Z',
  }
}
