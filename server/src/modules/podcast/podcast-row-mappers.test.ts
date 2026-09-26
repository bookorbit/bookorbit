import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

import type { PodcastEpisodeSort, PodcastSummary } from '@bookorbit/types';
import { buildEpisodeRuleClauses, episodeOrderBy } from './podcast-episode-query';
import { podcastArtworkUrl, toEpisodeListItem, toEpisodeSummary, toPodcastListItem, toPodcastSummary } from './podcast-row-mappers';

describe('Podcast row and query helpers episode pinning', () => {
  it('adds a user-state pinned clause to shared episode rules', () => {
    const buildClauses = buildEpisodeRuleClauses;
    const clauses = buildClauses(7, { filter: 'pinned', sort: 'newest', followedOnly: false });
    const query = new PgDialect().sqlToQuery(clauses.at(-1)!);

    expect(query.sql).toContain('pinned');
    expect(query.params).toContain(true);
  });

  it('projects pinned state into episode list items', () => {
    const mapEpisode = toEpisodeListItem;
    const item = mapEpisode({
      episode: {
        id: 11,
        podcastId: 12,
        origin: 'feed',
        title: 'Pinned orbit',
        season: null,
        episode: null,
        explicit: false,
        inFeed: true,
        publishedAt: null,
        durationSeconds: 600,
        enclosureType: 'audio/mp4',
      },
      podcastLibraryId: 7,
      podcastTitle: 'Orbit Radio',
      podcastImageUrl: null,
      podcastCustomArtworkAt: null,
      media: null,
      state: {
        positionSeconds: 0,
        progressPercent: 0,
        finished: false,
        pinned: true,
        lastListenedAt: null,
      },
      queuedEpisodeId: null,
    });

    expect(item.pinned).toBe(true);
  });

  it('reports the audio format a list row needs to name its download', () => {
    const base = {
      episode: {
        id: 11,
        podcastId: 12,
        origin: 'feed' as const,
        title: 'Orbit',
        season: null,
        episode: null,
        explicit: false,
        inFeed: true,
        publishedAt: null,
        durationSeconds: 600,
        enclosureType: 'audio/mp4',
      },
      podcastLibraryId: 7,
      podcastTitle: 'Orbit Radio',
      podcastImageUrl: null,
      podcastCustomArtworkAt: null,
      state: null,
      queuedEpisodeId: null,
    };

    // The cached copy is authoritative: it is the file the client will actually receive.
    expect(toEpisodeListItem({ ...base, media: { status: 'local', sizeBytes: 10, format: 'opus' } }).audioFormat).toBe('opus');
    // Otherwise the feed's declared MIME type, which is all a proxied episode has.
    expect(toEpisodeListItem({ ...base, media: null }).audioFormat).toBe('m4a');
    // Neither: null rather than a guess, so the client falls back knowingly.
    expect(toEpisodeListItem({ ...base, episode: { ...base.episode, enclosureType: null }, media: null }).audioFormat).toBeNull();
  });
});

describe('Podcast row and query helpers episode ordering', () => {
  const orderBy = episodeOrderBy;

  function renderedOrder(sort: PodcastEpisodeSort): string {
    return orderBy(sort)
      .map((clause) => new PgDialect().sqlToQuery(clause).sql)
      .join(', ');
  }

  it.each([
    ['newest', '"published_at" desc nulls last'],
    ['oldest', '"published_at" asc nulls last'],
    ['shortest', '"duration_seconds" asc nulls last'],
    ['longest', '"duration_seconds" desc nulls last'],
    ['recently_listened', '"last_listened_at" desc nulls last'],
  ] as const)('orders the episode list by %s', (sort, expected) => {
    expect(renderedOrder(sort)).toContain(expected);
  });
});

describe('Podcast row and query helpers episode summary media digest', () => {
  const mapEpisode = (row: unknown) => toEpisodeSummary(row as never, vi.fn());
  const digest = 'f'.repeat(64);

  const buildRow = (media: Record<string, unknown> | null, enclosureType: string | null = 'audio/mpeg') => ({
    episode: {
      id: 11,
      podcastId: 12,
      title: 'Cached orbit',
      subtitle: null,
      description: null,
      publishedAt: null,
      season: null,
      episode: null,
      episodeType: null,
      durationSeconds: 600,
      enclosureType,
      enclosureUrlEncrypted: 'encrypted',
      explicit: false,
      chapters: [],
      transcripts: [],
      inFeed: true,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-02T00:00:00.000Z'),
    },
    podcastLibraryId: 7,
    podcastTitle: 'Orbit Radio',
    podcastImageUrl: null,
    media,
    state: null,
    queuedEpisodeId: null,
  });

  it('publishes the stored digest for an episode the server holds', () => {
    const summary = mapEpisode(buildRow({ status: 'local', format: 'mp3', sizeBytes: 42, checksum: digest }));

    expect(summary.mediaStatus).toBe('local');
    expect(summary.checksum).toBe(digest);
  });

  it('withholds a digest that no longer describes anything the server holds', () => {
    // A removed download leaves its media row behind with the old hash; publishing it would have
    // a client verify its bytes against a copy the server has already thrown away.
    const removed = mapEpisode(buildRow({ status: 'remote', format: 'mp3', sizeBytes: null, checksum: digest }));
    const queued = mapEpisode(buildRow({ status: 'queued', format: 'mp3', sizeBytes: null, checksum: digest }));
    const never = mapEpisode(buildRow(null));

    expect(removed.checksum).toBeNull();
    expect(queued.checksum).toBeNull();
    expect(never.checksum).toBeNull();
  });

  it('reports a cached episode with no recorded digest as null rather than undefined', () => {
    const summary = mapEpisode(buildRow({ status: 'local', format: 'mp3', sizeBytes: 42, checksum: null }));

    expect(summary.checksum).toBeNull();
  });

  it('resolves an enclosure extension through the explicitly supplied decrypt callback', () => {
    const decrypt = vi.fn().mockReturnValue('https://example.com/episodes/orbit.m4b?download=1');

    const summary = toEpisodeSummary(buildRow(null, null) as never, decrypt);

    expect(summary.audioFormat).toBe('m4a');
    expect(decrypt).toHaveBeenCalledWith('encrypted');
  });

  it('returns no audio format when the explicit decrypt callback rejects the enclosure', () => {
    const decrypt = vi.fn(() => {
      throw new Error('invalid ciphertext');
    });

    expect(toEpisodeSummary(buildRow(null, null) as never, decrypt).audioFormat).toBeNull();
  });
});

describe('Podcast row and query helpers podcast list mapping', () => {
  const mapPodcast = toPodcastListItem as unknown as (
    podcast: {
      id: number;
      libraryId: number;
      title: string;
      author: null;
      imageUrlEncrypted: null;
      archivedAt: null;
      consecutiveFailures: number;
    },
    counts: {
      episodeCount: number;
      unplayedCount: number;
      downloadedCount: number;
      latestPublishedAt: Date | string | null;
    },
    recommendation: null,
    followed: boolean,
    notificationMode: 'off',
  ) => { latestPublishedAt: string | null };

  it.each([
    ['database string', '2026-07-29T20:00:00.000Z'],
    ['decoded date', new Date('2026-07-29T20:00:00.000Z')],
  ])('normalizes the latest published timestamp from a %s', (_label, latestPublishedAt) => {
    const item = mapPodcast(
      {
        id: 3,
        libraryId: 7,
        title: 'Orbit Radio',
        author: null,
        imageUrlEncrypted: null,
        archivedAt: null,
        consecutiveFailures: 0,
      },
      {
        episodeCount: 4,
        unplayedCount: 2,
        downloadedCount: 1,
        latestPublishedAt,
      },
      null,
      false,
      'off',
    );

    expect(item.latestPublishedAt).toBe('2026-07-29T20:00:00.000Z');
  });
});

describe('Podcast row and query helpers podcast summary mapping', () => {
  const mapPodcast = toPodcastSummary as unknown as (
    podcast: unknown,
    counts: { episodeCount: number; unplayedCount: number; downloadedCount: number },
    recommendation: null,
    followed: boolean,
    notificationMode: 'off',
  ) => PodcastSummary;

  it('exposes the website and user-scoped hero counts', () => {
    const timestamp = new Date('2026-07-29T20:00:00.000Z');
    const item = mapPodcast(
      {
        id: 3,
        libraryId: 7,
        title: 'Orbit Radio',
        author: 'Orbit',
        description: 'A show about orbit.',
        imageUrlEncrypted: null,
        siteUrl: 'https://example.com/orbit',
        language: 'en',
        podcastType: 'serial',
        explicit: false,
        categories: ['Science'],
        acquisitionPolicy: 'remote_only',
        autoDownloadLimit: null,
        autoDownloadWindowDays: null,
        refreshIntervalMinutes: 60,
        archivedAt: null,
        lastRefreshAt: timestamp,
        lastRefreshSuccessAt: timestamp,
        consecutiveFailures: 0,
        nextRefreshAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      { episodeCount: 4, unplayedCount: 2, downloadedCount: 1 },
      null,
      false,
      'off',
    );

    expect(item).toMatchObject({
      siteUrl: 'https://example.com/orbit',
      episodeCount: 4,
      unplayedCount: 2,
      downloadedCount: 1,
      imageUrl: null,
      artworkUpdatedAt: null,
    });
  });

  it('versions the artwork url from the custom upload so a replaced image is not served from cache', () => {
    const customArtworkAt = new Date('2026-07-31T10:00:00.000Z');

    expect(podcastArtworkUrl(3, null, customArtworkAt)).toBe(`/api/v1/podcasts/3/artwork?v=${customArtworkAt.getTime()}`);
    expect(podcastArtworkUrl(3, 'encrypted-feed-artwork', null)).toBe('/api/v1/podcasts/3/artwork');
    expect(podcastArtworkUrl(3, null, null)).toBeNull();
  });
});
