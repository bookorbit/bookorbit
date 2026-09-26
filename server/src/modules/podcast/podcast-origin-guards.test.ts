import { describe, expect, it } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { PodcastCatalogRepository } from './podcast-catalog.repository';
import { PodcastEpisodeRepository } from './podcast-episode.repository';

describe('PodcastOriginGuardRepository local-origin guards', () => {
  /**
   * Renders every WHERE the call builds. The builder is thenable at every stage because these
   * queries differ in where they stop chaining, and a method that issues more than one query has
   * all of them collected, because what is asserted is the predicate rather than the shape.
   */
  function captureWhere(run: (repositories: { catalog: PodcastCatalogRepository; episodes: PodcastEpisodeRepository }) => Promise<unknown>) {
    const captured: SQL[] = [];
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      from: () => builder,
      innerJoin: () => builder,
      leftJoin: () => builder,
      where: (clause: SQL) => {
        captured.push(clause);
        return builder;
      },
      orderBy: () => builder,
      limit: () => builder,
      offset: () => builder,
      then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
    });
    const db = { select: () => builder } as never;
    const repositories = {
      catalog: new PodcastCatalogRepository(db, {} as never, {} as never),
      episodes: new PodcastEpisodeRepository(db, {} as never),
    };
    return run(repositories).then(() => {
      const rendered = captured.map((clause) => new PgDialect().sqlToQuery(clause));
      return { sql: rendered.map((query) => query.sql).join(' ;; '), params: rendered.flatMap((query) => query.params) };
    });
  }

  it('never schedules a refresh for a show with no feed', async () => {
    const { sql, params } = await captureWhere(({ catalog }) => catalog.findDuePodcasts(100));

    expect(sql).toContain('"podcasts"."origin"');
    expect(params).toContain('feed');
  });

  it('never reports feed health for a show with no feed', async () => {
    const { sql, params } = await captureWhere(({ catalog }) => catalog.listFeedHealth(7, { page: 1, size: 25 }));

    expect(sql).toContain('"podcasts"."origin"');
    expect(params).toContain('feed');
  });

  it('never offers local media to pressure eviction', async () => {
    const { sql, params } = await captureWhere(({ episodes }) => episodes.findRetentionCandidates(7, 250));

    expect(sql).toContain('"podcast_episodes"."origin"');
    expect(params).toContain('feed');
  });

  it('never offers local media to post-listen cleanup', async () => {
    const { sql, params } = await captureWhere(({ episodes }) => episodes.findFinishedCleanupCandidates(7, 250));

    expect(sql).toContain('"podcast_episodes"."origin"');
    expect(params).toContain('feed');
  });

  it('never treats a local episode as downloadable, whatever its media status says', async () => {
    const { sql, params } = await captureWhere(({ episodes }) => episodes.filterDownloadableEpisodeIds([1, 2]));

    expect(sql).toContain('"podcast_episodes"."origin"');
    expect(params).toContain('feed');
  });

  it('leaves local files out of a bulk download removal', async () => {
    const { sql, params } = await captureWhere(({ episodes }) => episodes.findLocalPodcastEpisodeIds(3));

    expect(sql).toContain('"podcast_episodes"."origin"');
    expect(params).toContain('feed');
  });

  it('keeps local shows out of the scan that matches loose files to feed episodes', async () => {
    const { sql, params } = await captureWhere(({ episodes }) => episodes.listPodcastsForImport(7));

    expect(sql).toContain('"podcasts"."origin"');
    expect(params).toContain('feed');
  });

  it('keeps local episodes out of the match index, whichever way the scan reaches them', async () => {
    for (const run of [
      ({ episodes }: { episodes: PodcastEpisodeRepository }) => episodes.findImportEpisodesByIdentityHashes(7, ['a'.repeat(64)]),
      ({ episodes }: { episodes: PodcastEpisodeRepository }) => episodes.findImportEpisodesByIds(7, [11]),
      ({ episodes }: { episodes: PodcastEpisodeRepository }) => episodes.listImportEpisodesForPodcast(3, 0, 500),
    ]) {
      const { sql, params } = await captureWhere(run);

      expect(sql).toContain('"podcast_episodes"."origin"');
      expect(params).toContain('feed');
    }
  });

  it('exports only shows that have a feed to write into the OPML', async () => {
    const { sql, params } = await captureWhere(({ catalog }) => catalog.listPodcastSecrets(7, false, 0, 500));

    expect(sql).toContain('"podcasts"."origin"');
    expect(params).toContain('feed');
  });

  it('counts the local shows an export leaves behind', async () => {
    const { sql, params } = await captureWhere(({ catalog }) => catalog.countLocalPodcasts(7, false));

    expect(sql).toContain('"podcasts"."origin"');
    expect(params).toContain('local');
  });

  it('measures the bytes retention is not allowed to reclaim', async () => {
    const { sql, params } = await captureWhere(({ episodes }) => episodes.getUnevictableLocalBytes(7));

    expect(sql).toContain('"podcast_episodes"."origin"');
    expect(params).toContain('local');
  });
});
