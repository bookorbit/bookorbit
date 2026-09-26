import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { PodcastEpisodeRepository } from './podcast-episode.repository';

describe('PodcastEpisodeRepository episode metadata write', () => {
  const returning = vi.fn();
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const db = { update: vi.fn(() => ({ set })) };
  const repository = new PodcastEpisodeRepository(db as never, {} as never);

  beforeEach(() => {
    vi.clearAllMocks();
    returning.mockResolvedValue([{ id: 11 }]);
  });

  it('writes the edited values and the resulting lock set in one statement', async () => {
    await expect(repository.updateEpisodeMetadata(11, { title: 'Orbital mechanics' }, ['title', 'explicit'])).resolves.toEqual({ id: 11 });

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ title: 'Orbital mechanics', lockedFields: ['title', 'explicit'], updatedAt: expect.any(Date) });
  });

  it('reports a missing episode as null rather than undefined', async () => {
    returning.mockResolvedValue([]);

    await expect(repository.updateEpisodeMetadata(11, { explicit: true }, ['explicit'])).resolves.toBeNull();
  });
});

describe('PodcastEpisodeRepository post-listen cleanup candidates', () => {
  /**
   * The query is only ever meaningful against real rows, so what is asserted here is the predicate
   * set it is built from: one dropped clause is one class of episode deleted out from under a
   * listener who still wanted it.
   */
  function renderCandidateWhere() {
    let captured: SQL | undefined;
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      from: () => builder,
      innerJoin: () => builder,
      where: (clause: SQL) => {
        captured = clause;
        return builder;
      },
      orderBy: () => builder,
      limit: () => Promise.resolve([]),
    });
    const repository = new PodcastEpisodeRepository({ select: () => builder } as never, {} as never);
    return repository.findFinishedCleanupCandidates(7, 250).then(() => new PgDialect().sqlToQuery(captured!));
  }

  it('only considers downloads whose show opted into cleanup', async () => {
    const { sql, params } = await renderCandidateWhere();

    expect(sql).toContain('"podcasts"."download_cleanup"');
    expect(sql).toContain('"podcast_episode_media"."status"');
    expect(params).toContain('after_finished');
    expect(params).toContain('local');
    expect(params).toContain(7);
  });

  it('requires every listener to have finished and none to have pinned', async () => {
    const { sql } = await renderCandidateWhere();

    // `exists` is what keeps an episode nobody has state for out: "finished" is undefined for it.
    expect(sql).toContain('exists (');
    expect(sql).toContain('bool_and(s.finished)');
    expect(sql).toContain('not bool_or(s.pinned)');
  });

  it('keeps an episode any user still has queued', async () => {
    const { sql } = await renderCandidateWhere();

    expect(sql).toContain('not exists (select 1 from "user_podcast_queue" q where q.episode_id =');
  });

  it('measures the delay window from the last finish, per show', async () => {
    const { sql } = await renderCandidateWhere();

    expect(sql).toContain('max(s.finished_at) <=');
    expect(sql).toContain('"podcasts"."download_cleanup_delay_hours"');
    expect(sql).toContain("interval '1 hour'");
  });
});

/**
 * The origin guard matrix. Every one of these queries drives an automatic decision about somebody's
 * files, and for a local-origin episode the file is the only copy that exists. A missing predicate
 * here is not a cosmetic bug: it is the scheduler fetching a feed that is not there, or retention
 * deleting audio nothing can restore.
 */
