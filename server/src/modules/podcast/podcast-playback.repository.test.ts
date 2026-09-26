import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { PodcastPlaybackRepository } from './podcast-playback.repository';

describe('PodcastPlaybackRepository queue reordering', () => {
  const rows = [
    { episodeId: 11, libraryId: 7, position: 0 },
    { episodeId: 99, libraryId: 8, position: 1 },
    { episodeId: 12, libraryId: 7, position: 2 },
  ];
  const query = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
  };
  const updateWhere = vi.fn();
  const set = vi.fn();
  const tx = {
    execute: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
  };
  const db = {
    transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const repository = new PodcastPlaybackRepository(db as never);

  beforeEach(() => {
    vi.clearAllMocks();
    query.from.mockReturnValue(query);
    query.innerJoin.mockReturnValue(query);
    query.where.mockReturnValue(query);
    query.orderBy.mockResolvedValue(rows);
    tx.select.mockReturnValue(query);
    updateWhere.mockResolvedValue(undefined);
    set.mockReturnValue({ where: updateWhere });
    tx.update.mockReturnValue({ set });
  });

  it('reorders visible entries in their existing slots while preserving hidden entries', async () => {
    await expect(repository.reorderQueue(5, [12, 11], [7])).resolves.toBe(true);

    expect(tx.update).toHaveBeenCalledTimes(3);
    expect(set.mock.calls[1]?.[0]).toEqual({ position: 0 });
    expect(set.mock.calls[2]?.[0]).toEqual({ position: 2 });
  });

  it('rejects attempts to reorder entries from inaccessible libraries', async () => {
    await expect(repository.reorderQueue(5, [12, 99, 11], [7])).resolves.toBe(false);

    expect(tx.update).not.toHaveBeenCalled();
  });
});

describe('PodcastPlaybackRepository queue search', () => {
  const whereClauses: unknown[] = [];
  let selectCall = 0;

  function chainFor(result: unknown) {
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: (clause: unknown) => {
        whereClauses.push(clause);
        return chain;
      },
      orderBy: () => chain,
      limit: () => chain,
      offset: () => Promise.resolve(result),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return chain;
  }

  const results = [[], [{ count: 0 }], [{ totalDurationSeconds: '0' }]];
  const db = { select: vi.fn(() => chainFor(results[selectCall++])) };
  const repository = new PodcastPlaybackRepository(db as never);

  beforeEach(() => {
    vi.clearAllMocks();
    whereClauses.length = 0;
    selectCall = 0;
  });

  it('filters the rows, total, and duration queries with one shared clause', async () => {
    await repository.listQueue(5, { page: 1, size: 50, q: 'orbit' });

    expect(whereClauses).toHaveLength(3);
    expect(whereClauses[1]).toBe(whereClauses[0]);
    expect(whereClauses[2]).toBe(whereClauses[0]);
  });

  it('builds a different clause once a search term is supplied', async () => {
    await repository.listQueue(5, { page: 1, size: 50 });
    const withoutSearch = whereClauses[0];

    whereClauses.length = 0;
    selectCall = 0;
    await repository.listQueue(5, { page: 1, size: 50, q: 'orbit' });

    expect(whereClauses[0]).not.toEqual(withoutSearch);
  });
});

describe('PodcastPlaybackRepository continue listening', () => {
  const limits: number[] = [];
  let rows: unknown[] = [];

  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: (value: number) => {
      limits.push(value);
      return Promise.resolve(rows);
    },
  };
  const db = { select: vi.fn(() => chain) };
  const repository = new PodcastPlaybackRepository(db as never);

  beforeEach(() => {
    vi.clearAllMocks();
    limits.length = 0;
    rows = [];
  });

  it('returns nothing without querying when the user can reach no library', async () => {
    await expect(repository.listContinueListening(5, 10, [])).resolves.toEqual([]);

    expect(db.select).not.toHaveBeenCalled();
  });

  it('asks the database for exactly the requested number of episodes', async () => {
    await repository.listContinueListening(5, 4, [7]);

    expect(limits).toEqual([4]);
  });
});

describe('PodcastPlaybackRepository playlist queueing', () => {
  const limits: number[] = [];
  const insertedValues: { userId: number; episodeId: number; position: number }[][] = [];
  let results: unknown[] = [];
  let selectCall = 0;

  function chainFor(result: unknown) {
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: (value: number) => {
        limits.push(value);
        return Promise.resolve(result);
      },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return chain;
  }

  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    select: vi.fn(() => chainFor(results[selectCall++])),
    insert: vi.fn(() => ({
      values: (rows: { userId: number; episodeId: number; position: number }[]) => {
        insertedValues.push(rows);
        return Promise.resolve(undefined);
      },
    })),
  };
  const db = { transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)) };
  const repository = new PodcastPlaybackRepository(db as never);
  const rules = { filter: 'unplayed', sort: 'shortest', maxDurationMinutes: 20, followedOnly: false } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    limits.length = 0;
    insertedValues.length = 0;
    selectCall = 0;
  });

  it('appends matching episodes after the last queue position and reports what it skipped', async () => {
    results = [[{ count: 2, max: 5 }], [{ count: 9 }], [{ id: 40 }], [{ id: 41 }, { id: 42 }]];

    await expect(repository.addQueryEpisodesToQueue(5, 7, rules, 100)).resolves.toEqual({ added: 2, skipped: 7, firstEpisodeId: 41 });

    expect(insertedValues[0]).toEqual([
      { userId: 5, episodeId: 41, position: 6 },
      { userId: 5, episodeId: 42, position: 7 },
    ]);
  });

  it('never requests more candidates than the remaining queue capacity', async () => {
    results = [[{ count: 995, max: 994 }], [{ count: 400 }], [{ id: 40 }], [{ id: 41 }]];

    await repository.addQueryEpisodesToQueue(5, 7, rules, 100);

    expect(limits).toEqual([1, 5]);
  });

  it('queues nothing once the queue is full but still reports a first match for playback', async () => {
    results = [[{ count: 1000, max: 999 }], [{ count: 12 }], [{ id: 40 }]];

    await expect(repository.addQueryEpisodesToQueue(5, 7, rules, 100)).resolves.toEqual({ added: 0, skipped: 12, firstEpisodeId: 40 });

    expect(tx.insert).not.toHaveBeenCalled();
  });
});

describe('PodcastPlaybackRepository episode state writes', () => {
  const returning = vi.fn();
  const onConflictDoUpdate = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const limit = vi.fn();
  const selectChain = { from: vi.fn(), where: vi.fn(), limit };
  const db = { insert: vi.fn(() => ({ values })), select: vi.fn(() => selectChain) };
  const repository = new PodcastPlaybackRepository(db as never);

  beforeEach(() => {
    vi.clearAllMocks();
    selectChain.from.mockReturnValue(selectChain);
    selectChain.where.mockReturnValue(selectChain);
  });

  it('applies the write unconditionally when no capture time is given', async () => {
    returning.mockResolvedValue([{ episodeId: 11, positionSeconds: 30 }]);

    await expect(repository.upsertEpisodeState(5, 11, { positionSeconds: 30 })).resolves.toMatchObject({ positionSeconds: 30 });

    expect(onConflictDoUpdate.mock.calls[0]?.[0]).not.toHaveProperty('setWhere');
    expect(db.select).not.toHaveBeenCalled();
  });

  it('guards the conflict update with the capture time and returns the stored row when the write is skipped', async () => {
    returning.mockResolvedValue([]);
    limit.mockResolvedValue([{ episodeId: 11, positionSeconds: 900 }]);
    const capturedAt = new Date('2026-07-29T10:00:00.000Z');

    await expect(repository.upsertEpisodeState(5, 11, { positionSeconds: 30 }, capturedAt)).resolves.toMatchObject({
      positionSeconds: 900,
    });

    const conflict = onConflictDoUpdate.mock.calls[0]?.[0] as { setWhere?: SQL };
    const guard = new PgDialect().sqlToQuery(conflict.setWhere!);
    expect(guard.sql).toContain('"updated_at" <=');
    expect(guard.params).toContain(capturedAt.toISOString());
  });
});

describe('PodcastPlaybackRepository finish dequeues the episode', () => {
  const returning = vi.fn();
  const onConflictDoUpdate = vi.fn(() => ({ returning }));
  const insertValues = vi.fn(() => ({ onConflictDoUpdate }));
  const stateLimit = vi.fn();
  const queueLimit = vi.fn();
  const stateSelectChain = { from: vi.fn(), where: vi.fn(), limit: stateLimit };
  const queueSelectChain = { from: vi.fn(), where: vi.fn(), limit: queueLimit };
  const deleteWhere = vi.fn();
  const updateWhere = vi.fn();
  const set = vi.fn();
  let selectsQueueRow = true;
  const tx = {
    execute: vi.fn(),
    insert: vi.fn(() => ({ values: insertValues })),
    select: vi.fn((projection?: Record<string, unknown>) => (projection && 'position' in projection ? queueSelectChain : stateSelectChain)),
    delete: vi.fn(() => ({ where: deleteWhere })),
    update: vi.fn(() => ({ set })),
  };
  const db = {
    transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
    insert: vi.fn(() => ({ values: insertValues })),
    select: vi.fn(() => stateSelectChain),
  };
  const repository = new PodcastPlaybackRepository(db as never);

  beforeEach(() => {
    vi.clearAllMocks();
    selectsQueueRow = true;
    stateSelectChain.from.mockReturnValue(stateSelectChain);
    stateSelectChain.where.mockReturnValue(stateSelectChain);
    queueSelectChain.from.mockReturnValue(queueSelectChain);
    queueSelectChain.where.mockReturnValue(queueSelectChain);
    queueLimit.mockImplementation(() => Promise.resolve(selectsQueueRow ? [{ position: 2 }] : []));
    set.mockReturnValue({ where: updateWhere });
    updateWhere.mockResolvedValue(undefined);
    deleteWhere.mockResolvedValue(undefined);
  });

  it('removes the finished episode from the queue in the same transaction', async () => {
    returning.mockResolvedValue([{ episodeId: 11, finished: true }]);

    await repository.upsertEpisodeState(5, 11, { finished: true, positionSeconds: 1_800 });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(tx.delete).toHaveBeenCalledTimes(1);
    // The two shifting updates re-compact the positions behind the removed entry.
    expect(tx.update).toHaveBeenCalledTimes(2);
  });

  it('leaves the queue alone when the episode was not queued', async () => {
    returning.mockResolvedValue([{ episodeId: 11, finished: true }]);
    selectsQueueRow = false;

    await repository.upsertEpisodeState(5, 11, { finished: true });

    expect(tx.delete).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('does not dequeue when the stale-write guard skipped the finish', async () => {
    returning.mockResolvedValue([]);
    stateLimit.mockResolvedValue([{ episodeId: 11, finished: false }]);

    await repository.upsertEpisodeState(5, 11, { finished: true }, new Date('2026-07-29T10:00:00.000Z'));

    expect(tx.delete).not.toHaveBeenCalled();
  });

  it('does not open a transaction for a position-only write', async () => {
    returning.mockResolvedValue([{ episodeId: 11, positionSeconds: 30 }]);

    await repository.upsertEpisodeState(5, 11, { positionSeconds: 30 });

    expect(db.transaction).not.toHaveBeenCalled();
  });
});

describe('PodcastPlaybackRepository single queue move', () => {
  const rows = [
    { episodeId: 11, libraryId: 7, position: 0 },
    { episodeId: 99, libraryId: 8, position: 1 },
    { episodeId: 12, libraryId: 7, position: 2 },
    { episodeId: 13, libraryId: 7, position: 3 },
  ];
  const query = { from: vi.fn(), innerJoin: vi.fn(), where: vi.fn(), orderBy: vi.fn() };
  const updateWhere = vi.fn();
  const set = vi.fn();
  const tx = { execute: vi.fn(), select: vi.fn(), update: vi.fn() };
  const db = {
    transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const repository = new PodcastPlaybackRepository(db as never);

  beforeEach(() => {
    vi.clearAllMocks();
    query.from.mockReturnValue(query);
    query.innerJoin.mockReturnValue(query);
    query.where.mockReturnValue(query);
    query.orderBy.mockResolvedValue(rows);
    tx.select.mockReturnValue(query);
    updateWhere.mockResolvedValue(undefined);
    set.mockReturnValue({ where: updateWhere });
    tx.update.mockReturnValue({ set });
  });

  it('parks the moved row, rotates the run between the slots, and lands on the target slot', async () => {
    await expect(repository.moveQueueItem(5, 13, 1, [7])).resolves.toBe(true);

    // Visible order is [11, 12, 13]; index 1 is the slot episode 12 holds, which is position 2.
    expect(set.mock.calls[0]?.[0]).toEqual({ position: 2_000_003 });
    expect(set.mock.calls.at(-1)?.[0]).toEqual({ position: 2 });
  });

  it('clamps a target index past the end of the visible queue', async () => {
    await expect(repository.moveQueueItem(5, 11, 99, [7])).resolves.toBe(true);

    expect(set.mock.calls.at(-1)?.[0]).toEqual({ position: 3 });
  });

  it('is a no-op when the entry already sits at the target index', async () => {
    await expect(repository.moveQueueItem(5, 11, 0, [7])).resolves.toBe(true);

    expect(tx.update).not.toHaveBeenCalled();
  });

  it('refuses to move an entry the user cannot see', async () => {
    await expect(repository.moveQueueItem(5, 99, 0, [7])).resolves.toBe(false);

    expect(tx.update).not.toHaveBeenCalled();
  });

  it('refuses to move an entry that is not queued', async () => {
    await expect(repository.moveQueueItem(5, 42, 0, [7])).resolves.toBe(false);
  });
});

describe('PodcastPlaybackRepository play-all start point', () => {
  let matched: { id: number; mediaStatus: string | null }[] = [];
  let candidates: { id: number; mediaStatus: string | null }[] = [];
  let selectCall = 0;

  function chainFor(result: unknown) {
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(result),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return chain;
  }

  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
    // Order of selects in addQueryEpisodesToQueue: queue state, matched count, first match, then candidates.
    select: vi.fn(() => {
      const call = selectCall++;
      if (call === 0) return chainFor([{ count: 0, max: -1 }]);
      if (call === 1) return chainFor([{ count: matched.length }]);
      if (call === 2) return chainFor(matched.slice(0, 1));
      return chainFor(candidates);
    }),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
  };
  const db = {
    transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const repository = new PodcastPlaybackRepository(db as never);
  const query = { sort: 'newest' } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    selectCall = 0;
  });

  it('starts on the first playable match rather than one whose media is gone', async () => {
    matched = [
      { id: 1, mediaStatus: 'unavailable' },
      { id: 2, mediaStatus: 'local' },
    ];
    candidates = matched;

    await expect(repository.addQueryEpisodesToQueue(5, 13, query, 100)).resolves.toMatchObject({ added: 2, firstEpisodeId: 2 });
  });

  it('treats a remote episode with no download as playable, because it still streams', async () => {
    matched = [{ id: 7, mediaStatus: 'remote' }];
    candidates = matched;

    await expect(repository.addQueryEpisodesToQueue(5, 13, query, 100)).resolves.toMatchObject({ firstEpisodeId: 7 });
  });

  it('still reports a start point when nothing is playable, so the player states the failure', async () => {
    matched = [{ id: 3, mediaStatus: 'unavailable' }];
    candidates = matched;

    await expect(repository.addQueryEpisodesToQueue(5, 13, query, 100)).resolves.toMatchObject({ firstEpisodeId: 3 });
  });

  it('falls back to the first match when everything matched is already queued', async () => {
    matched = [
      { id: 4, mediaStatus: 'unavailable' },
      { id: 5, mediaStatus: 'local' },
    ];
    candidates = [];

    await expect(repository.addQueryEpisodesToQueue(5, 13, query, 100)).resolves.toMatchObject({ added: 0, firstEpisodeId: 4 });
  });
});
