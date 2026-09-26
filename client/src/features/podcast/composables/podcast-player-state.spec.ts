import { describe, expect, it } from 'vitest'
import type { PodcastEpisodeSummary, PodcastPlaybackPreferences } from '@bookorbit/types'
import { createPodcastPlayerState } from './podcast-player-state'

describe('createPodcastPlayerState', () => {
  it('derives progress, chapter, and per-podcast rate state from one reactive graph', () => {
    const state = createPodcastPlayerState(preferences())
    state.episode.value = episode()
    state.duration.value = 300
    state.currentTime.value = 125

    expect(state.progressPercent.value).toBeCloseTo(41.67, 2)
    expect(state.activeChapterIndex.value).toBe(1)
    expect(state.hasPlaybackRateOverride.value).toBe(false)

    state.podcastPlaybackRates.value = { '3': 1.5 }
    expect(state.hasPlaybackRateOverride.value).toBe(true)
  })

  it('copies mutable preference defaults between independently created state graphs', () => {
    const defaults = preferences()
    const first = createPodcastPlayerState(defaults)
    const second = createPodcastPlayerState(defaults)
    first.podcastPlaybackRates.value['3'] = 2

    expect(second.podcastPlaybackRates.value).toEqual({})
    expect(defaults.podcastPlaybackRates).toEqual({})
  })
})

function preferences(): PodcastPlaybackPreferences {
  return {
    defaultPlaybackRate: 1,
    volume: 1,
    skipBackwardSeconds: 15,
    skipForwardSeconds: 30,
    podcastPlaybackRates: {},
  }
}

function episode(): PodcastEpisodeSummary {
  return {
    id: 42,
    libraryId: 2,
    origin: 'feed',
    podcastId: 3,
    podcastTitle: 'Orbit Radio',
    podcastImageUrl: null,
    title: 'First episode',
    subtitle: null,
    description: null,
    publishedAt: null,
    season: null,
    episode: null,
    episodeType: null,
    durationSeconds: 300,
    audioFormat: 'mp3',
    explicit: false,
    chapters: [
      { title: 'One', startSeconds: 0 },
      { title: 'Two', startSeconds: 100 },
    ],
    transcripts: [],
    lockedFields: [],
    inFeed: true,
    mediaStatus: 'remote',
    localSizeBytes: null,
    checksum: null,
    positionSeconds: 30,
    progressPercent: 10,
    finished: false,
    pinned: false,
    queued: false,
    lastListenedAt: null,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
  }
}
