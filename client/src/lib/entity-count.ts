import type { MediaType } from '@bookorbit/types'

export interface CountableEntity {
  /** Libraries discriminate on `type`; scopes and collections on `mediaType`. */
  type?: string
  mediaType?: MediaType
  bookCount?: number | null
  podcastCount?: number | null
  episodeCount?: number | null
}

function isPodcastEntity(item: CountableEntity): boolean {
  return item.type === 'podcasts' || item.mediaType === 'podcasts'
}

/**
 * The count that belongs to an entity's medium. Podcast libraries and collections count shows,
 * podcast scopes count matching episodes, and everything else counts books. Without the
 * medium check a podcast entity reads its empty `bookCount` and renders a misleading zero.
 */
export function entityCount(item: CountableEntity): number | null {
  if (isPodcastEntity(item)) {
    const count = item.podcastCount ?? item.episodeCount
    return typeof count === 'number' ? count : null
  }
  return typeof item.bookCount === 'number' ? item.bookCount : null
}
