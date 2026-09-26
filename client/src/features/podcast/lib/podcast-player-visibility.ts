import type { RouteLocationNormalizedLoaded } from 'vue-router'

/**
 * The reader owns the bottom edge for its own TTS and media-overlay players, so the
 * podcast mini player stays out of the way there even while an episode is loaded.
 */
export function shouldShowPodcastMiniPlayer(route: RouteLocationNormalizedLoaded, hasEpisode: boolean): boolean {
  return hasEpisode && route.name !== 'podcast-player' && route.name !== 'reader' && route.meta?.public !== true
}
