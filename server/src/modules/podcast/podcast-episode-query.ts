import { BadRequestException } from '@nestjs/common';
import { and, asc, desc, eq, gt, gte, ilike, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { PodcastEpisodeFilter, PodcastPlaylistSort, PodcastScopeRules } from '@bookorbit/types';
import { podcastEpisodeMedia, podcastEpisodes, podcasts, userPodcastEpisodeState, userPodcastFollows } from '../../db/schema';

/**
 * The published range accepts what its DTO advertises: `@IsISO8601` passes a bare date and a full
 * timestamp alike. A bare date covers the whole day; a timestamp is taken as given. Appending a time
 * to a value that already carried one produced an Invalid Date that reached the driver as a 500.
 */
function parsePublishedBoundary(value: string, edge: 'start' | 'end'): Date {
  const hasTime = value.includes('T');
  const parsed = new Date(hasTime ? value : `${value}${edge === 'start' ? 'T00:00:00.000Z' : 'T23:59:59.999Z'}`);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${edge === 'start' ? 'publishedFrom' : 'publishedTo'} is not a valid date`);
  }
  return parsed;
}

export type PodcastEpisodeRuleQuery = {
  q?: string;
  filter: PodcastEpisodeFilter;
  sort: PodcastPlaylistSort;
  publishedFrom?: string;
  publishedTo?: string;
  publishedWithinDays?: number;
  podcastId?: number;
  podcastIds?: number[];
  minDurationMinutes?: number;
  maxDurationMinutes?: number;
  followedOnly: boolean;
};

/**
 * Stored scope rules use null for "no bound"; this query type uses absence. Converting in one
 * place keeps a null from reaching a clause builder that would read it as a real bound.
 */
export function toEpisodeRuleQuery(rules: PodcastScopeRules): PodcastEpisodeRuleQuery {
  return {
    filter: rules.filter,
    sort: rules.sort,
    followedOnly: rules.followedOnly,
    ...(rules.minDurationMinutes !== null ? { minDurationMinutes: rules.minDurationMinutes } : {}),
    ...(rules.maxDurationMinutes !== null ? { maxDurationMinutes: rules.maxDurationMinutes } : {}),
    ...(rules.publishedWithinDays !== null ? { publishedWithinDays: rules.publishedWithinDays } : {}),
    ...(rules.podcastIds.length > 0 ? { podcastIds: rules.podcastIds } : {}),
  };
}

export function buildEpisodeRuleClauses(libraryId: number, query: PodcastEpisodeRuleQuery): SQL[] {
  const clauses: SQL[] = [eq(podcasts.libraryId, libraryId), isNull(podcasts.archivedAt)];
  if (query.podcastId) clauses.push(eq(podcastEpisodes.podcastId, query.podcastId));
  if (query.podcastIds?.length) clauses.push(inArray(podcastEpisodes.podcastId, query.podcastIds));
  if (query.q) {
    clauses.push(or(ilike(podcastEpisodes.title, `%${query.q}%`), ilike(podcasts.title, `%${query.q}%`))!);
  }
  if (query.followedOnly) clauses.push(isNotNull(userPodcastFollows.userId));
  if (query.publishedFrom) clauses.push(gte(podcastEpisodes.publishedAt, parsePublishedBoundary(query.publishedFrom, 'start')));
  if (query.publishedTo) clauses.push(lt(podcastEpisodes.publishedAt, parsePublishedBoundary(query.publishedTo, 'end')));
  if (query.publishedWithinDays) {
    clauses.push(sql`${podcastEpisodes.publishedAt} >= now() - make_interval(days => ${query.publishedWithinDays})`);
  }
  if (query.minDurationMinutes) clauses.push(gte(podcastEpisodes.durationSeconds, query.minDurationMinutes * 60));
  if (query.maxDurationMinutes) {
    clauses.push(and(isNotNull(podcastEpisodes.durationSeconds), lte(podcastEpisodes.durationSeconds, query.maxDurationMinutes * 60))!);
  }
  if (query.filter === 'downloaded') clauses.push(eq(podcastEpisodeMedia.status, 'local'));
  if (query.filter === 'in_progress') {
    clauses.push(
      and(isNotNull(userPodcastEpisodeState.userId), eq(userPodcastEpisodeState.finished, false), gt(userPodcastEpisodeState.positionSeconds, 0))!,
    );
  }
  if (query.filter === 'unplayed') {
    clauses.push(
      or(isNull(userPodcastEpisodeState.userId), and(eq(userPodcastEpisodeState.finished, false), eq(userPodcastEpisodeState.positionSeconds, 0)))!,
    );
  }
  if (query.filter === 'finished') clauses.push(eq(userPodcastEpisodeState.finished, true));
  if (query.filter === 'pinned') clauses.push(eq(userPodcastEpisodeState.pinned, true));
  return clauses;
}

export function episodeOrderBy(sort: PodcastPlaylistSort): SQL[] {
  if (sort === 'oldest') return [sql`${podcastEpisodes.publishedAt} asc nulls last`, asc(podcastEpisodes.id)];
  if (sort === 'shortest') return [sql`${podcastEpisodes.durationSeconds} asc nulls last`, asc(podcastEpisodes.id)];
  if (sort === 'longest') return [sql`${podcastEpisodes.durationSeconds} desc nulls last`, desc(podcastEpisodes.id)];
  if (sort === 'recently_listened') return [sql`${userPodcastEpisodeState.lastListenedAt} desc nulls last`, desc(podcastEpisodes.id)];
  return [sql`${podcastEpisodes.publishedAt} desc nulls last`, desc(podcastEpisodes.id)];
}
