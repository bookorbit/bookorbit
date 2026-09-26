import { BadRequestException } from '@nestjs/common';

import {
  PODCAST_PLAYLIST_MAX_DURATION_MINUTES,
  PODCAST_PLAYLIST_MAX_PUBLISHED_WITHIN_DAYS,
  PODCAST_PLAYLIST_MAX_SHOWS,
  type PodcastEpisodeFilter,
  type PodcastPlaylistSort,
  type PodcastScopeRules,
} from '@bookorbit/types';

/**
 * Podcast scopes store the flat rule set the saved playlists already used, so this is the podcast
 * counterpart of validateGroupRule: it re-checks everything on the way in, because the column is
 * jsonb and a stored value that no longer parses would otherwise reach the query builder.
 *
 * Deliberately accepts `pinned`, which the playlist preferences schema omitted. That omission made
 * saving a pinned playlist fail and made reading one discard the user's whole list.
 */
const EPISODE_FILTERS: readonly PodcastEpisodeFilter[] = ['latest', 'downloaded', 'in_progress', 'unplayed', 'finished', 'pinned'];
const EPISODE_SORTS: readonly PodcastPlaylistSort[] = ['newest', 'oldest', 'shortest', 'longest', 'recently_listened'];

/** Keeps an object or array out of an error message, where it would render as [object Object]. */
function describe(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

const KNOWN_RULE_KEYS = new Set(['filter', 'sort', 'minDurationMinutes', 'maxDurationMinutes', 'publishedWithinDays', 'podcastIds', 'followedOnly']);

const MAX_DURATION_MINUTES = PODCAST_PLAYLIST_MAX_DURATION_MINUTES;
const MAX_PUBLISHED_WITHIN_DAYS = PODCAST_PLAYLIST_MAX_PUBLISHED_WITHIN_DAYS;

function assertOptionalPositiveInt(value: unknown, field: string, max: number): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    throw new BadRequestException(`${field} must be a whole number between 1 and ${max}`);
  }
  return value;
}

export function validatePodcastScopeRules(input: unknown): PodcastScopeRules | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestException('Podcast scope rules must be an object');
  }

  const raw = input as Record<string, unknown>;

  // Reject anything outside the vocabulary rather than defaulting it away: a book GroupRule
  // posted here would otherwise silently become a scope that matches every episode.
  const unknownKeys = Object.keys(raw).filter((key) => !KNOWN_RULE_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new BadRequestException(`Unknown podcast scope rule fields: ${unknownKeys.join(', ')}`);
  }

  const filter = raw.filter ?? 'latest';
  if (!EPISODE_FILTERS.includes(filter as PodcastEpisodeFilter)) {
    throw new BadRequestException(`Unknown podcast episode filter: ${describe(filter)}`);
  }

  const sort = raw.sort ?? 'newest';
  if (!EPISODE_SORTS.includes(sort as PodcastPlaylistSort)) {
    throw new BadRequestException(`Unknown podcast episode sort: ${describe(sort)}`);
  }

  const minDurationMinutes = assertOptionalPositiveInt(raw.minDurationMinutes, 'minDurationMinutes', MAX_DURATION_MINUTES);
  const maxDurationMinutes = assertOptionalPositiveInt(raw.maxDurationMinutes, 'maxDurationMinutes', MAX_DURATION_MINUTES);
  if (minDurationMinutes !== null && maxDurationMinutes !== null && minDurationMinutes > maxDurationMinutes) {
    throw new BadRequestException('minDurationMinutes cannot exceed maxDurationMinutes');
  }

  const publishedWithinDays = assertOptionalPositiveInt(raw.publishedWithinDays, 'publishedWithinDays', MAX_PUBLISHED_WITHIN_DAYS);

  const podcastIdsInput = raw.podcastIds ?? [];
  if (!Array.isArray(podcastIdsInput)) {
    throw new BadRequestException('podcastIds must be an array');
  }
  if (podcastIdsInput.length > PODCAST_PLAYLIST_MAX_SHOWS) {
    throw new BadRequestException(`A podcast scope can target at most ${PODCAST_PLAYLIST_MAX_SHOWS} shows`);
  }
  const podcastIds = podcastIdsInput.map((id) => {
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) {
      throw new BadRequestException('podcastIds must contain positive integers');
    }
    return id;
  });

  if (raw.followedOnly !== undefined && typeof raw.followedOnly !== 'boolean') {
    throw new BadRequestException('followedOnly must be a boolean');
  }

  return {
    filter: filter as PodcastEpisodeFilter,
    sort: sort as PodcastPlaylistSort,
    minDurationMinutes,
    maxDurationMinutes,
    publishedWithinDays,
    podcastIds: [...new Set(podcastIds)],
    followedOnly: raw.followedOnly === true,
  };
}
