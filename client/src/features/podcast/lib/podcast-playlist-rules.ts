import type { PodcastPlaylistRules } from '@bookorbit/types'

export const DEFAULT_PLAYLIST_RULES: PodcastPlaylistRules = {
  filter: 'latest',
  sort: 'newest',
  minDurationMinutes: null,
  maxDurationMinutes: null,
  publishedWithinDays: null,
  podcastIds: [],
  followedOnly: false,
}

/** Adds only the rules that narrow the match, so an unset rule never reaches the API as an empty value. */
export function appendPlaylistRuleParams(params: URLSearchParams, rules: PodcastPlaylistRules): void {
  params.set('filter', rules.filter)
  params.set('sort', rules.sort)
  params.set('followedOnly', String(rules.followedOnly))
  if (rules.minDurationMinutes) params.set('minDurationMinutes', String(rules.minDurationMinutes))
  if (rules.maxDurationMinutes) params.set('maxDurationMinutes', String(rules.maxDurationMinutes))
  if (rules.publishedWithinDays) params.set('publishedWithinDays', String(rules.publishedWithinDays))
  if (rules.podcastIds.length > 0) params.set('podcastIds', rules.podcastIds.join(','))
}

export function playlistRuleBody(rules: PodcastPlaylistRules): Record<string, unknown> {
  return {
    filter: rules.filter,
    sort: rules.sort,
    followedOnly: rules.followedOnly,
    ...(rules.minDurationMinutes ? { minDurationMinutes: rules.minDurationMinutes } : {}),
    ...(rules.maxDurationMinutes ? { maxDurationMinutes: rules.maxDurationMinutes } : {}),
    ...(rules.publishedWithinDays ? { publishedWithinDays: rules.publishedWithinDays } : {}),
    ...(rules.podcastIds.length > 0 ? { podcastIds: [...rules.podcastIds] } : {}),
  }
}

export function normalizePlaylistRules(rules: Partial<PodcastPlaylistRules>): PodcastPlaylistRules {
  return {
    ...DEFAULT_PLAYLIST_RULES,
    ...rules,
    podcastIds: [...(rules.podcastIds ?? [])],
  }
}
