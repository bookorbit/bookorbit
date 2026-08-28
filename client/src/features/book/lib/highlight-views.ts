import type { HighlightGroupMode } from './highlight-groups'

/**
 * The single control at the top of the Highlights tab, mirroring the library hub's. One key
 * picks the grouping and the sort together, so there is never a second dropdown whose only
 * job is to contradict the first.
 *
 * Unlike the hub, the grouping here does not have to match a server sort: a book's highlights
 * arrive in one bounded window and the groups are built from the server's own chapter and
 * colour aggregates, so bucketing on the client stays correct as more pages load.
 */
export type HighlightViewKey = 'position' | 'newest' | 'oldest' | 'colour' | 'source'

export interface HighlightViewSpec {
  group: HighlightGroupMode
  sortBy: 'position' | 'createdAt'
  sortDir: 'asc' | 'desc'
}

export const HIGHLIGHT_VIEWS: Record<HighlightViewKey, HighlightViewSpec> = {
  position: { group: 'chapter', sortBy: 'position', sortDir: 'asc' },
  newest: { group: 'day', sortBy: 'createdAt', sortDir: 'desc' },
  oldest: { group: 'day', sortBy: 'createdAt', sortDir: 'asc' },
  colour: { group: 'colour', sortBy: 'position', sortDir: 'asc' },
  source: { group: 'source', sortBy: 'position', sortDir: 'asc' },
}

export const HIGHLIGHT_VIEW_KEYS = Object.keys(HIGHLIGHT_VIEWS) as HighlightViewKey[]

export function isHighlightViewKey(value: string): value is HighlightViewKey {
  return value in HIGHLIGHT_VIEWS
}
