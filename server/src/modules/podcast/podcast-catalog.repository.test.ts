import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { PODCAST_EPISODE_LOCKED_FIELDS } from '@bookorbit/types';
import { PodcastCatalogRepository, podcastListFilter } from './podcast-catalog.repository';

describe('PodcastCatalogRepository directory subscription lookup', () => {
  let results: unknown[][] = [];
  let selectCall = 0;

  function chainFor(result: unknown[]) {
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return chain;
  }

  const db = { select: vi.fn(() => chainFor(results[selectCall++] ?? [])) };
  const repository = new PodcastCatalogRepository(db as never, {} as never, {} as never);

  beforeEach(() => {
    vi.clearAllMocks();
    selectCall = 0;
    results = [];
  });

  it('skips the query when there is nothing to resolve or no library the caller can see', async () => {
    await expect(repository.findPodcastIdsByFeedHashes([], [7])).resolves.toEqual([]);
    await expect(repository.findPodcastIdsByFeedHashes(['hash'], [])).resolves.toEqual([]);

    expect(db.select).not.toHaveBeenCalled();
  });

  it('resolves hashes through the alias table as well as the stored feed URL', async () => {
    results = [[{ feedHash: 'a', podcastId: 1, libraryId: 7 }], [{ feedHash: 'b', podcastId: 2, libraryId: 9 }]];

    await expect(repository.findPodcastIdsByFeedHashes(['a', 'b'], [7, 9])).resolves.toEqual([
      { feedHash: 'a', podcastId: 1, libraryId: 7 },
      { feedHash: 'b', podcastId: 2, libraryId: 9 },
    ]);
    expect(db.select).toHaveBeenCalledTimes(2);
  });
});

describe('PodcastCatalogRepository refresh lock survival', () => {
  const conflict = { target: undefined as unknown, set: {} as Record<string, unknown> };
  const inserted: unknown[][] = [];
  const tx = {
    update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({
      values: (rows: unknown[]) => {
        inserted.push(rows);
        return {
          onConflictDoUpdate: (options: typeof conflict) => {
            Object.assign(conflict, options);
            return { returning: () => Promise.resolve([{ id: 11, identityHash: 'hash-1' }]) };
          },
          onConflictDoNothing: () => Promise.resolve(undefined),
        };
      },
    }),
  };
  const parser = { identityHash: (value: string) => `hash-${value}` };
  const secrets = { encrypt: (value: string) => value, hashUrl: (value: string) => value };
  const repository = new PodcastCatalogRepository({} as never, secrets as never, parser as never);
  const syncEpisodes = Reflect.get(repository, 'syncEpisodesTx').bind(repository) as (
    transaction: typeof tx,
    podcastId: number,
    episodes: unknown[],
    now: Date,
  ) => Promise<number[]>;

  beforeEach(async () => {
    inserted.length = 0;
    await syncEpisodes(
      tx,
      3,
      [
        {
          identity: '1',
          guid: 'guid-1',
          title: 'Feed title',
          subtitle: null,
          description: null,
          publishedAt: null,
          season: null,
          episode: null,
          episodeType: null,
          durationSeconds: 600,
          explicit: false,
          enclosureUrl: 'https://cdn.example/1.mp3',
          enclosureType: 'audio/mpeg',
          enclosureSizeBytes: 1,
          chapters: [],
          transcripts: [],
        },
      ],
      new Date('2026-07-31T00:00:00.000Z'),
    );
  });

  // Every field the metadata endpoint can write has to be guarded here, or the edit survives only
  // until the feed is next fetched.
  it.each(PODCAST_EPISODE_LOCKED_FIELDS)('keeps a locked %s instead of taking the feed value', (field) => {
    const rendered = new PgDialect().sqlToQuery(conflict.set[field] as SQL).sql;

    expect(rendered).toContain(`"locked_fields" ? '${field}'`);
  });

  it('lets the feed own identity and delivery fields regardless of the lock set', () => {
    for (const field of ['guid', 'enclosureUrlEncrypted', 'enclosureUrlHash', 'enclosureType', 'enclosureSizeBytes', 'transcripts']) {
      expect(new PgDialect().sqlToQuery(conflict.set[field] as SQL).sql).not.toContain('locked_fields');
    }
  });

  it('only marks episodes the feed still lists as in-feed, leaving a dropped episode untouched', () => {
    // Everything is flipped out of feed first; an episode the feed no longer carries is absent from
    // the upsert values, so neither its columns nor its locks are rewritten.
    expect(conflict.set.inFeed).toBe(true);
    expect(inserted[0]).toHaveLength(1);
    expect((inserted[0] as { identityHash: string }[])[0]?.identityHash).toBe('hash-1');
  });
});

describe('PodcastCatalogRepository merge across origins', () => {
  it('inherits only a feed address the source actually has', async () => {
    const statements: string[] = [];
    const tx = {
      execute: vi.fn((statement: SQL) => {
        statements.push(new PgDialect().sqlToQuery(statement).sql);
        return Promise.resolve(undefined);
      }),
      delete: () => ({ where: () => Promise.resolve(undefined) }),
    };
    const selectBuilder: Record<string, unknown> = {};
    Object.assign(selectBuilder, {
      from: () => selectBuilder,
      where: () => selectBuilder,
      orderBy: () => selectBuilder,
      limit: () => Promise.resolve([]),
    });
    const db = {
      select: () => selectBuilder,
      transaction: (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    };
    const repository = new PodcastCatalogRepository(db as never, {} as never, {} as never);

    await repository.mergePodcastInto(4, 3, 7);

    // A local source has no feed columns to copy, and both are NOT NULL on the alias table, so the
    // insert has to skip it rather than fail the whole merge.
    const aliasInsert = statements.find((statement) => statement.includes('insert into "podcast_feed_aliases"'))!;
    expect(aliasInsert).toContain('feed_url_hash is not null');
    expect(aliasInsert).toContain('feed_url_encrypted is not null');
  });
});

describe('PodcastCatalogRepository feed reparse', () => {
  const podcastUpdates: Array<Record<string, unknown>> = [];
  let podcastRow: Record<string, unknown>;
  const tx = {
    select: vi.fn(() => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([podcastRow]) }) }) })),
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => {
        podcastUpdates.push(values);
        return { where: () => Promise.resolve(undefined) };
      },
    })),
  };
  const db = { transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)) };
  const secrets = { encrypt: vi.fn((value: string) => `encrypted:${value}`), hashUrl: vi.fn(() => 'feed-hash') };
  const repository = new PodcastCatalogRepository(db as never, secrets as never, {} as never);
  const feed = {
    title: 'Orbit Radio Weekly',
    author: 'Orbit',
    description: 'Reparsed description',
    imageUrl: 'https://example.com/art.png',
    siteUrl: 'https://example.com',
    language: 'en',
    podcastType: 'serial',
    explicit: true,
    categories: ['Science'],
    episodes: [],
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    podcastUpdates.length = 0;
    podcastRow = {
      id: 3,
      origin: 'feed',
      title: 'Orbit Radio',
      author: 'Orbit',
      description: 'Stored description',
      imageUrlEncrypted: 'encrypted-artwork',
      siteUrl: null,
      language: null,
      podcastType: null,
      explicit: false,
      categories: [],
      feedUrlHash: 'feed-hash',
      feedUrlEncrypted: 'encrypted-feed-url',
      lockedFields: [],
      refreshIntervalMinutes: 60,
    };
  });

  // The second update is the podcast row; the first is the in-feed reset every episode sync starts with.
  const podcastUpdate = () => podcastUpdates.at(-1)!;

  it('leaves the refresh schedule, cache validators, and failure counters alone', async () => {
    await repository.reparsePodcastFeed(3, feed);

    expect(podcastUpdate()).toMatchObject({ title: 'Orbit Radio Weekly', description: 'Reparsed description' });
    for (const untouched of [
      'etag',
      'lastModified',
      'lastHttpStatus',
      'lastRefreshAt',
      'lastRefreshSuccessAt',
      'nextRefreshAt',
      'consecutiveFailures',
      'lastError',
      'feedUrlEncrypted',
      'feedUrlHash',
      'feedSnapshotAt',
    ]) {
      expect(podcastUpdate()).not.toHaveProperty(untouched);
    }
  });

  it('writes back exactly what is stored when the snapshot has not changed', async () => {
    Object.assign(podcastRow, {
      title: feed.title,
      author: feed.author,
      description: feed.description,
      imageUrlEncrypted: `encrypted:${feed.imageUrl}`,
      siteUrl: feed.siteUrl,
      language: feed.language,
      podcastType: feed.podcastType,
      explicit: feed.explicit,
      categories: feed.categories,
    });

    await repository.reparsePodcastFeed(3, feed);

    const { updatedAt, ...written } = podcastUpdate();
    expect(updatedAt).toBeInstanceOf(Date);
    expect(written).toEqual({
      title: podcastRow.title,
      author: podcastRow.author,
      description: podcastRow.description,
      imageUrlEncrypted: podcastRow.imageUrlEncrypted,
      siteUrl: podcastRow.siteUrl,
      language: podcastRow.language,
      podcastType: podcastRow.podcastType,
      explicit: podcastRow.explicit,
      categories: podcastRow.categories,
    });
  });

  it('honors locked fields exactly like a refresh does', async () => {
    podcastRow.lockedFields = ['title', 'description', 'imageUrl', 'categories'];

    await repository.reparsePodcastFeed(3, feed);

    expect(podcastUpdate()).toMatchObject({
      title: 'Orbit Radio',
      description: 'Stored description',
      imageUrlEncrypted: 'encrypted-artwork',
      categories: [],
      author: 'Orbit',
      explicit: true,
    });
  });

  it('reports an empty result rather than writing anything when the podcast is already gone', async () => {
    podcastRow = undefined as never;

    await expect(repository.reparsePodcastFeed(3, feed)).resolves.toEqual({ insertedEpisodeIds: [], episodeCount: 0 });

    expect(podcastUpdates).toHaveLength(0);
  });
});

describe('podcastListFilter', () => {
  function render(query: Parameters<typeof podcastListFilter>[1]): string {
    const filter = podcastListFilter(7, query);
    if (!filter) throw new Error('expected a filter');
    return new PgDialect().sqlToQuery(filter).sql;
  }

  it('narrows to missing shows only when asked', () => {
    expect(render({ archived: false, missing: true })).toContain('"missing_at" is not null');
    expect(render({ archived: false, missing: false })).not.toContain('missing_at');
    expect(render({ archived: false })).not.toContain('missing_at');
  });

  it('keeps missing a narrowing filter rather than an archive-style mode', () => {
    // Both sides of the archive line stay reachable while the missing filter is on, which is what
    // makes it safe to leave off: an unfiltered list still holds the missing shows.
    expect(render({ archived: false, missing: true })).toContain('"archived_at" is null');
    expect(render({ archived: true, missing: true })).toContain('"archived_at" is not null');
  });

  it('composes with the search and id filters instead of replacing them', () => {
    const sql = render({ archived: false, missing: true, q: 'orbit', podcastIds: [3, 4] });

    expect(sql).toContain('"missing_at" is not null');
    expect(sql).toContain('ilike');
    expect(sql).toContain('in (');
  });
});
