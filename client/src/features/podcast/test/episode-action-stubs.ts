import { vi } from 'vitest'
import { PODCAST_EPISODE_ACTIONS, type PodcastEpisodeListActions } from '../composables/usePodcastEpisodeListActions'

/**
 * A recording stand-in for the actions an episode row injects, so a spec can assert which action a
 * control triggers without standing up the player, the queue, and a router behind it.
 */
export function createPodcastEpisodeActionsStub() {
  return {
    play: vi.fn<PodcastEpisodeListActions['play']>(async () => undefined),
    openPlayer: vi.fn<PodcastEpisodeListActions['openPlayer']>(),
    openDetails: vi.fn<PodcastEpisodeListActions['openDetails']>(),
    openMetadataEditor: vi.fn<PodcastEpisodeListActions['openMetadataEditor']>(),
    queue: vi.fn<PodcastEpisodeListActions['queue']>(async () => undefined),
    queueNext: vi.fn<PodcastEpisodeListActions['queueNext']>(async () => undefined),
    unqueue: vi.fn<PodcastEpisodeListActions['unqueue']>(async () => undefined),
    download: vi.fn<PodcastEpisodeListActions['download']>(async () => undefined),
    removeDownload: vi.fn<PodcastEpisodeListActions['removeDownload']>(async () => undefined),
    finish: vi.fn<PodcastEpisodeListActions['finish']>(async () => undefined),
    unfinish: vi.fn<PodcastEpisodeListActions['unfinish']>(async () => undefined),
    pin: vi.fn<PodcastEpisodeListActions['pin']>(async () => undefined),
    unpin: vi.fn<PodcastEpisodeListActions['unpin']>(async () => undefined),
  }
}

export type PodcastEpisodeActionsStub = ReturnType<typeof createPodcastEpisodeActionsStub>

/** Drops the stub where `inject` will find it, for `global.provide` in a mount call. */
export function provideEpisodeActions(actions: PodcastEpisodeActionsStub): Record<symbol, unknown> {
  return { [PODCAST_EPISODE_ACTIONS as symbol]: actions }
}
