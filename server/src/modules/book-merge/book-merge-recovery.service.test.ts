import { Logger } from '@nestjs/common';

import type { BookMergeSourceOutcome } from '@bookorbit/types';

import { LibraryOperationGate } from '../../common/services/library-operation-gate.service';
import type { BookMergeJobMove } from '../../db/schema';
import type { BookMergeEffectsService } from './book-merge-effects.service';
import { BookMergeRecoveryService } from './book-merge-recovery.service';
import type { BookMergeExecutor } from './book-merge.executor';
import type { MergeExecutionPlan } from './book-merge.planner';
import type { BookMergeRepository, MergeJobRow } from './book-merge.repository';

const PLAN: MergeExecutionPlan = {
  libraryId: 1,
  targetBookId: 1,
  destinationBookId: 1,
  destination: { libraryFolderId: 11, libraryFolderPath: '/library', folderPath: '/library/Dune' },
  steps: [2, 3].map((sourceBookId) => ({
    sourceBookId,
    moves: [],
    targetFileIds: [],
    droppedSidecarFileIds: [],
    vacatedFolders: [],
    roots: ['/library'],
  })),
  fieldSources: {},
  excludeTagIds: [],
  excludeGenreIds: [],
  hiddenRequestIds: [],
  identicalPairs: [],
  deleteIdenticalCopies: false,
  watched: false,
};

const JOURNAL: BookMergeJobMove[] = [
  {
    fileId: 30,
    from: '/library/Dune Copy/Dune.pdf',
    to: '/library/Dune/Dune.pdf',
    phase: 'done',
    expectedSize: 10,
    expectedMtimeMs: 1,
    movedSize: 10,
  },
];

function outcome(sourceBookId: number, status: BookMergeSourceOutcome['status']): BookMergeSourceOutcome {
  return { sourceBookId, status, errorCode: null };
}

function jobRow(overrides: Partial<MergeJobRow> = {}): MergeJobRow {
  return {
    id: 40,
    libraryId: 1,
    libraryIds: null,
    targetBookId: 1,
    destinationBookId: 1,
    sourceBookIds: [2, 3],
    requestedByUserId: 7,
    status: 'planned',
    plan: PLAN as unknown as Record<string, unknown>,
    moves: [],
    outcomes: [],
    result: null,
    currentSourceBookId: null,
    processed: 0,
    total: 2,
    errorCode: null,
    error: null,
    createdAt: new Date('2026-11-01T10:00:00Z'),
    updatedAt: new Date('2026-11-01T10:00:00Z'),
    finishedAt: null,
    ...overrides,
  };
}

function createRecovery() {
  const repository = { findUnfinishedJobs: vi.fn().mockResolvedValue([]), updateJob: vi.fn().mockResolvedValue(undefined) };
  const executor = { rollback: vi.fn().mockResolvedValue([]) };
  const effects = { apply: vi.fn().mockResolvedValue(0) };
  const libraryGate = new LibraryOperationGate();
  const recovery = new BookMergeRecoveryService(
    repository as unknown as BookMergeRepository,
    executor as unknown as BookMergeExecutor,
    effects as unknown as BookMergeEffectsService,
    libraryGate,
  );
  return { recovery, repository, executor, effects, libraryGate };
}

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BookMergeRecoveryService', () => {
  it('fails a planned job as INTERRUPTED without touching files or effects', async () => {
    const { recovery, repository, executor, effects, libraryGate } = createRecovery();

    await recovery.recover(jobRow({ status: 'planned' }));

    expect(repository.updateJob).toHaveBeenCalledWith(40, { status: 'failed', errorCode: 'INTERRUPTED', finishedAt: expect.any(Date) });
    expect(executor.rollback).not.toHaveBeenCalled();
    expect(effects.apply).not.toHaveBeenCalled();
    expect(libraryGate.isHeld(1)).toBe(false);
  });

  it.each(['moving', 'committing'])('rolls back the interrupted step of a %s job and keeps earlier merged sources', async (status) => {
    const { recovery, repository, executor, effects } = createRecovery();
    const job = jobRow({ status, moves: JOURNAL, currentSourceBookId: 3, outcomes: [outcome(2, 'merged'), outcome(3, 'pending')] });

    await recovery.recover(job);

    expect(executor.rollback).toHaveBeenCalledWith(40, JOURNAL);
    expect(effects.apply).toHaveBeenCalledWith({
      job,
      plan: PLAN,
      mergedSourceIds: [2],
      affectedUserIds: null,
      ratingChangedUserIds: null,
      koboEntitlementMovedUserIds: null,
    });
    expect(repository.updateJob).toHaveBeenCalledWith(40, {
      status: 'rolled_back',
      outcomes: [outcome(2, 'merged'), { sourceBookId: 3, status: 'rolled_back', errorCode: 'INTERRUPTED' }],
      moves: [],
      currentSourceBookId: null,
      errorCode: 'INTERRUPTED',
      error: null,
      finishedAt: expect.any(Date),
    });
  });

  it('fails the job and keeps the journal when a file cannot be moved back', async () => {
    const { recovery, repository, executor } = createRecovery();
    executor.rollback.mockResolvedValue(JOURNAL);

    await recovery.recover(
      jobRow({ status: 'moving', moves: JOURNAL, currentSourceBookId: 2, outcomes: [outcome(2, 'pending'), outcome(3, 'pending')] }),
    );

    expect(repository.updateJob).toHaveBeenCalledWith(
      40,
      expect.objectContaining({
        status: 'failed',
        outcomes: [{ sourceBookId: 2, status: 'failed', errorCode: 'INTERRUPTED' }, outcome(3, 'pending')],
        moves: JOURNAL,
        errorCode: 'INTERRUPTED',
        error: '/library/Dune/Dune.pdf -> /library/Dune Copy/Dune.pdf',
      }),
    );
  });

  it('records the interrupted source as rolled back when the first step was interrupted', async () => {
    const { recovery, repository } = createRecovery();

    await recovery.recover(jobRow({ status: 'moving', moves: JOURNAL, currentSourceBookId: 2, outcomes: [] }));

    expect(repository.updateJob).toHaveBeenCalledWith(
      40,
      expect.objectContaining({
        status: 'rolled_back',
        outcomes: [{ sourceBookId: 2, status: 'rolled_back', errorCode: 'INTERRUPTED' }, outcome(3, 'pending')],
        errorCode: 'INTERRUPTED',
      }),
    );
  });

  it('applies the effects a fully committed job still owes and finishes it as done', async () => {
    const { recovery, repository, executor, effects } = createRecovery();
    const job = jobRow({ status: 'committed', currentSourceBookId: 3, processed: 2, outcomes: [outcome(2, 'merged'), outcome(3, 'merged')] });

    await recovery.recover(job);

    expect(executor.rollback).not.toHaveBeenCalled();
    expect(effects.apply).toHaveBeenCalledWith(expect.objectContaining({ job, mergedSourceIds: [2, 3], affectedUserIds: null }));
    expect(repository.updateJob).toHaveBeenCalledWith(
      40,
      expect.objectContaining({ status: 'done', errorCode: null, moves: [], currentSourceBookId: null }),
    );
  });

  it('passes on the readers each committed step stored, so the per-user effects still run after a restart', async () => {
    const { recovery, effects } = createRecovery();
    const plan = {
      ...PLAN,
      readers: {
        '2': { affectedUserIds: [7, 8], ratingChangedUserIds: [8], koboEntitlementMovedUserIds: [] },
        '3': { affectedUserIds: [8, 9], ratingChangedUserIds: [], koboEntitlementMovedUserIds: [10] },
      },
    };
    const job = jobRow({ status: 'committed', plan, processed: 2, outcomes: [outcome(2, 'merged'), outcome(3, 'merged')] });

    await recovery.recover(job);

    expect(effects.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        mergedSourceIds: [2, 3],
        affectedUserIds: [7, 8, 9],
        ratingChangedUserIds: [8],
        koboEntitlementMovedUserIds: [10],
      }),
    );
  });

  it('applies effects for the merged sources of a job stopped between steps', async () => {
    const { recovery, repository, effects } = createRecovery();

    await recovery.recover(
      jobRow({ status: 'committed', currentSourceBookId: 2, processed: 1, outcomes: [outcome(2, 'merged'), outcome(3, 'pending')] }),
    );

    expect(effects.apply).toHaveBeenCalledWith(expect.objectContaining({ mergedSourceIds: [2] }));
    expect(repository.updateJob).toHaveBeenCalledWith(40, expect.objectContaining({ status: 'rolled_back', errorCode: 'INTERRUPTED' }));
  });

  it('holds the library gate while recovering and releases it afterwards, even on failure', async () => {
    const { recovery, executor, libraryGate } = createRecovery();
    const heldDuringRollback: boolean[] = [];
    executor.rollback.mockImplementation(() => {
      heldDuringRollback.push(libraryGate.current(1) === 'book_merge');
      return Promise.reject(new Error('disk gone'));
    });

    await expect(recovery.recover(jobRow({ status: 'moving', moves: JOURNAL }))).resolves.toBeUndefined();

    expect(heldDuringRollback).toEqual([true]);
    expect(libraryGate.isHeld(1)).toBe(false);
  });

  it('holds every library a merge across libraries touched while recovering it', async () => {
    const { recovery, executor, libraryGate } = createRecovery();
    const held: boolean[] = [];
    executor.rollback.mockImplementation(() => {
      held.push(libraryGate.isHeld(1), libraryGate.isHeld(2));
      return Promise.resolve([]);
    });

    await recovery.recover(jobRow({ status: 'moving', moves: JOURNAL, libraryIds: [1, 2] }));

    expect(held).toEqual([true, true]);
    expect(libraryGate.isHeld(2)).toBe(false);
  });

  it('recovers every unfinished job on module init and survives an unreadable job table', async () => {
    const { recovery, repository } = createRecovery();
    repository.findUnfinishedJobs.mockResolvedValue([jobRow({ id: 1 }), jobRow({ id: 2 })]);

    await recovery.onModuleInit();

    expect(repository.updateJob.mock.calls.map(([jobId]) => jobId)).toEqual([1, 2]);

    repository.findUnfinishedJobs.mockRejectedValue(new Error('relation does not exist'));
    await expect(recovery.onModuleInit()).resolves.toBeUndefined();
  });
});
