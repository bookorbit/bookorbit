import { describe, expect, it } from 'vitest'
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import { shouldShowPodcastMiniPlayer } from './podcast-player-visibility'

function routeAt(name: string, meta: Record<string, unknown> = {}): RouteLocationNormalizedLoaded {
  return { name, meta } as unknown as RouteLocationNormalizedLoaded
}

describe('shouldShowPodcastMiniPlayer', () => {
  it('shows the mini player on ordinary authed routes with a loaded episode', () => {
    expect(shouldShowPodcastMiniPlayer(routeAt('podcast-library'), true)).toBe(true)
    expect(shouldShowPodcastMiniPlayer(routeAt('HomeView'), true)).toBe(true)
  })

  it('stays hidden without a loaded episode', () => {
    expect(shouldShowPodcastMiniPlayer(routeAt('podcast-library'), false)).toBe(false)
  })

  it('stays hidden where another surface owns playback or the bottom edge', () => {
    expect(shouldShowPodcastMiniPlayer(routeAt('podcast-player'), true)).toBe(false)
    expect(shouldShowPodcastMiniPlayer(routeAt('reader'), true)).toBe(false)
  })

  it('stays hidden on public routes', () => {
    expect(shouldShowPodcastMiniPlayer(routeAt('login', { public: true }), true)).toBe(false)
  })
})
