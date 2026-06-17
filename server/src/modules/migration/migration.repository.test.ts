import * as schema from '../../db/schema';
import { MigrationRepository } from './migration.repository';

describe('MigrationRepository', () => {
  it('deduplicates path lookups and queries in chunks of 500', async () => {
    const where = vi
      .fn()
      .mockResolvedValueOnce([{ absolutePath: '/books/1.epub' }])
      .mockResolvedValueOnce([{ absolutePath: '/books/2.epub' }])
      .mockResolvedValueOnce([{ absolutePath: '/books/3.epub' }]);
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    const repo = new MigrationRepository({ select } as never);
    const inputPaths = Array.from({ length: 1001 }, (_, i) => `/books/${i}.epub`);
    inputPaths.push('/books/1.epub', '', '   ');

    const existing = await repo.findExistingBookFilePaths(inputPaths);

    expect(where).toHaveBeenCalledTimes(3);
    expect(existing).toEqual(new Set(['/books/1.epub', '/books/2.epub', '/books/3.epub']));
  });

  it('short-circuits path lookup when no non-empty input paths are provided', async () => {
    const select = vi.fn();
    const repo = new MigrationRepository({ select } as never);

    await expect(repo.findExistingBookFilePaths(['', '   '])).resolves.toEqual(new Set());
    expect(select).not.toHaveBeenCalled();
  });

  it('purges run state and removes all plan artifacts when there are no completed runs', async () => {
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });

    const selectWhere = vi.fn().mockResolvedValue([]);
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
    const select = vi.fn().mockReturnValue({ from: selectFrom });

    const repo = new MigrationRepository({ delete: deleteFn, select } as never);
    await repo.purgeRunState(7);

    expect(deleteFn).toHaveBeenNthCalledWith(1, schema.migrationRuns);
    expect(deleteFn).toHaveBeenNthCalledWith(2, schema.migrationPlanArtifacts);
    expect(deleteWhere).toHaveBeenCalledTimes(2);
  });

  it('retains completed-run artifacts while purging transient state', async () => {
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });

    const selectWhere = vi.fn().mockResolvedValue([{ planArtifactId: 10 }, { planArtifactId: null }]);
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
    const select = vi.fn().mockReturnValue({ from: selectFrom });

    const repo = new MigrationRepository({ delete: deleteFn, select } as never);
    await repo.purgeRunState(8);

    expect(deleteWhere).toHaveBeenCalledTimes(2);
  });

  it('returns active run without creating a new run when lock finds one', async () => {
    const activeRun = { id: 99, state: 'running' };

    const limit = vi.fn().mockResolvedValue([activeRun]);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    const tx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select,
      delete: vi.fn(),
      insert: vi.fn(),
    };
    const db = {
      transaction: vi.fn().mockImplementation(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    };

    const repo = new MigrationRepository(db as never);
    const result = await repo.createRunWithLock({
      sourceId: 1,
      profileId: 2,
      planArtifactId: 3,
      targetKey: 'bookorbit',
      state: 'running',
      currentStage: 'init',
      triggeredByUserId: 7,
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(result).toEqual({ run: null, activeRun });
    expect(tx.delete).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('creates a new run when lock has no active run and defaults target key', async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    const insertReturning = vi.fn().mockResolvedValue([{ id: 101, targetKey: 'bookorbit' }]);
    const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
    const insert = vi.fn().mockReturnValue({ values: insertValues });
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });

    const tx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select,
      delete: deleteFn,
      insert,
    };
    const db = {
      transaction: vi.fn().mockImplementation(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    };

    const repo = new MigrationRepository(db as never);
    const result = await repo.createRunWithLock({
      sourceId: 1,
      profileId: 2,
      planArtifactId: 3,
      targetKey: null,
      state: 'running',
      currentStage: 'init',
      triggeredByUserId: 7,
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        targetKey: 'bookorbit',
      }),
    );
    expect(result).toEqual({
      run: { id: 101, targetKey: 'bookorbit' },
      activeRun: null,
    });
  });

  it('handles insert/update/find wrappers and null fallbacks', async () => {
    const insertReturning = vi
      .fn()
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([{ id: 2 }])
      .mockResolvedValueOnce([{ id: 3 }]);
    const onConflictDoUpdate = vi.fn().mockReturnValue({ returning: insertReturning });
    const insertValues = vi.fn().mockReturnValue({ returning: insertReturning, onConflictDoUpdate });
    const insert = vi.fn().mockReturnValue({ values: insertValues });

    const updateReturning = vi
      .fn()
      .mockResolvedValueOnce([{ id: 10 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 12 }])
      .mockResolvedValueOnce([{ id: 14 }])
      .mockResolvedValueOnce([]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const update = vi.fn().mockReturnValue({ set: updateSet });

    const query = {
      migrationSources: { findFirst: vi.fn(() => Promise.resolve({ id: 100 })) },
      migrationProfiles: { findFirst: vi.fn(() => Promise.resolve({ id: 200 })) },
      migrationPlanArtifacts: { findFirst: vi.fn(() => Promise.resolve({ id: 300 })) },
      migrationRuns: { findFirst: vi.fn(() => Promise.resolve({ id: 400 })) },
    };
    const repo = new MigrationRepository({ insert, update, query } as never);

    await expect(
      repo.createSource({ type: 'booklore', name: 'Source', connectionConfig: {}, capabilities: {}, createdByUserId: 1 } as never),
    ).resolves.toEqual({
      id: 1,
    });
    await expect(
      repo.createPlanArtifact({
        sourceId: 1,
        profileId: 2,
        sourceSnapshotHash: 'a',
        profileHash: 'b',
        planHash: 'c',
        plan: {},
        sourceData: {},
        summary: {},
        createdByUserId: 1,
      } as never),
    ).resolves.toEqual({ id: 2 });
    await expect(
      repo.setRunMetric(1, 'user_state', 'bookmarks', {
        processed: 1,
        imported: 1,
      }),
    ).resolves.toEqual({ id: 3 });

    await expect(
      repo.updateSource(1, { type: 'booklore', name: 'A', connectionConfig: {}, capabilities: {}, createdByUserId: 1 } as never),
    ).resolves.toEqual({
      id: 10,
    });
    await expect(repo.updateSourceValidation(1, { capabilities: {}, lastValidatedAt: null } as never)).resolves.toBeNull();
    await expect(repo.updateProfileScope(1, {})).resolves.toEqual({ id: 12 });
    await expect(repo.updatePlanArtifact(1, { plan: {}, summary: {} })).resolves.toEqual({ id: 14 });
    await expect(repo.updateRunState(1, 'failed', {})).resolves.toBeNull();

    await expect(repo.findSourceById(100)).resolves.toEqual({ id: 100 });
    await expect(repo.findProfileById(200)).resolves.toEqual({ id: 200 });
    await expect(repo.findPlanArtifactById(300)).resolves.toEqual({ id: 300 });
    await expect(repo.findRunById(400)).resolves.toEqual({ id: 400 });
  });

  it('deletes migration sources and returns null when no row is deleted', async () => {
    const returning = vi
      .fn()
      .mockResolvedValueOnce([{ id: 7 }])
      .mockResolvedValueOnce([]);
    const where = vi.fn().mockReturnValue({ returning });
    const deleteFn = vi.fn().mockReturnValue({ where });

    const repo = new MigrationRepository({ delete: deleteFn } as never);

    await expect(repo.deleteSource(7)).resolves.toEqual({ id: 7 });
    await expect(repo.deleteSource(8)).resolves.toBeNull();

    expect(deleteFn).toHaveBeenCalledWith(schema.migrationSources);
    expect(where).toHaveBeenCalledTimes(2);
  });

  it('lists sources/profiles/plans/runs and run metrics via select query chains', async () => {
    const orderBy = vi.fn().mockResolvedValue([{ id: 1 }]);
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where, orderBy });
    const select = vi.fn().mockReturnValue({ from });
    const repo = new MigrationRepository({ select } as never);

    await expect(repo.listSources()).resolves.toEqual([{ id: 1 }]);
    await expect(repo.listProfiles()).resolves.toEqual([{ id: 1 }]);
    await expect(repo.listProfiles(5)).resolves.toEqual([{ id: 1 }]);
    await expect(repo.listPlanArtifacts()).resolves.toEqual([{ id: 1 }]);
    await expect(repo.listPlanArtifacts(5)).resolves.toEqual([{ id: 1 }]);
    await expect(repo.listRuns()).resolves.toEqual([{ id: 1 }]);
    await expect(repo.listRuns(5)).resolves.toEqual([{ id: 1 }]);
    await expect(repo.listRunMetrics(5)).resolves.toEqual([{ id: 1 }]);

    expect(select).toHaveBeenCalledTimes(8);
  });

  it('builds title and metric lookups and supports empty-input short-circuits', async () => {
    const limit = vi
      .fn()
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([]);
    const where = vi
      .fn()
      .mockResolvedValueOnce([
        { bookId: 11, title: 'Dune' },
        { bookId: 12, title: null },
      ])
      .mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });
    const repo = new MigrationRepository({ select, delete: deleteFn } as never);

    await expect(repo.findBookTitlesByIds([])).resolves.toEqual(new Map());
    await expect(repo.findBookTitlesByIds([11, 12])).resolves.toEqual(
      new Map([
        [11, 'Dune'],
        [12, null],
      ]),
    );

    await expect(repo.hasStageMetrics(7, 'user_state')).resolves.toBe(true);
    await expect(repo.hasStageMetrics(7, 'user_state')).resolves.toBe(false);
    await repo.clearStageMetrics(7, 'user_state');

    expect(deleteFn).toHaveBeenCalledWith(schema.migrationRunMetrics);
    expect(deleteWhere).toHaveBeenCalledTimes(1);
  });
});
