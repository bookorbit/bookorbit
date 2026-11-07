vi.mock('../../common/utils/file-move.utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../common/utils/file-move.utils')>();
  return { ...actual, moveFileBack: vi.fn(actual.moveFileBack) };
});

import { Logger } from '@nestjs/common';
import { existsSync } from 'fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join, relative } from 'path';

import { FileLockService } from '../../common/services/file-lock.service';
import { SelfWriteRegistry } from '../../common/services/self-write-registry.service';
import { moveFileBack } from '../../common/utils/file-move.utils';
import type { BookMergeJobMove } from '../../db/schema';
import type { BookConsolidationService, ConsolidateResult } from '../book-consolidation/book-consolidation.service';
import type { BookCoverStore } from '../book-cover-store/book-cover-store.service';
import type { FileRenameService } from '../file-write/file-rename.service';
import { BookMergeExecutor } from './book-merge.executor';
import type { MergeExecutionPlan, MergeStep, PlannedMove } from './book-merge.planner';
import type { BookMergeRepository, MergeJobRow } from './book-merge.repository';

let workDir: string;
let libraryRoot: string;
let targetFolder: string;

async function writeBook(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function plannedMove(fileId: number, bookId: number, from: string, to: string): Promise<PlannedMove> {
  const info = await stat(from);
  return {
    fileId,
    bookId,
    from,
    to,
    relPath: relative(libraryRoot, to),
    kind: 'move',
    expectedSize: info.size,
    expectedMtimeMs: Math.trunc(info.mtimeMs),
    crossDevice: false,
  };
}

function stepOf(sourceBookId: number, moves: PlannedMove[], vacatedFolders: string[] = []): MergeStep {
  return { sourceBookId, moves, targetFileIds: [], droppedSidecarFileIds: [], vacatedFolders, roots: [libraryRoot] };
}

function planOf(steps: MergeStep[], targetBookId = 1): MergeExecutionPlan {
  return {
    libraryId: 1,
    targetBookId,
    destinationBookId: targetBookId,
    destination: { libraryFolderId: 11, libraryFolderPath: libraryRoot, folderPath: targetFolder },
    steps,
    fieldSources: { title: targetBookId },
    excludeTagIds: [],
    excludeGenreIds: [],
    hiddenRequestIds: [],
    identicalPairs: [],
    deleteIdenticalCopies: false,
    watched: false,
  };
}

function jobOf(plan: MergeExecutionPlan): MergeJobRow {
  return {
    id: 40,
    libraryId: plan.libraryId,
    targetBookId: plan.targetBookId,
    destinationBookId: plan.destinationBookId,
    sourceBookIds: plan.steps.map((step) => step.sourceBookId),
    requestedByUserId: 7,
    status: 'planned',
    plan: plan as unknown as Record<string, unknown>,
    moves: [],
    outcomes: [],
    result: null,
    currentSourceBookId: null,
    processed: 0,
    total: plan.steps.length,
    errorCode: null,
    error: null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    finishedAt: null,
  };
}

function consolidated(): ConsolidateResult {
  return {
    snapshot: {} as ConsolidateResult['snapshot'],
    affectedUserIds: [7],
    ratingChangedUserIds: [],
    koboEntitlementMovedUserIds: [],
    sourceHadKoboEntitlements: false,
  };
}

interface JournalSnapshot {
  journal: BookMergeJobMove[];
  fromExists: boolean;
  toExists: boolean;
}

function createExecutor() {
  const tx = { name: 'tx' };
  const journalSnapshots: JournalSnapshot[] = [];
  let inTransaction = false;
  const repository = {
    updateJob: vi.fn().mockResolvedValue(undefined),
    setMoves: vi.fn((_jobId: number, journal: BookMergeJobMove[]) => {
      const last = journal[journal.length - 1];
      journalSnapshots.push({ journal: structuredClone(journal), fromExists: existsSync(last.from), toExists: existsSync(last.to) });
      return Promise.resolve();
    }),
    transaction: vi.fn(async (work: (handle: unknown) => Promise<unknown>) => {
      inTransaction = true;
      try {
        return await work(tx);
      } finally {
        inTransaction = false;
      }
    }),
  };
  const consolidateSawTransaction: boolean[] = [];
  const consolidation = {
    consolidate: vi.fn(() => {
      consolidateSawTransaction.push(inTransaction);
      return Promise.resolve(consolidated());
    }),
  };
  const fileLocks = new FileLockService();
  const selfWrites = new SelfWriteRegistry();
  const coverStore = { slotsForAdoption: vi.fn().mockResolvedValue([]) };
  const fileRename = { cancelPendingRename: vi.fn() };
  const executor = new BookMergeExecutor(
    repository as unknown as BookMergeRepository,
    consolidation as unknown as BookConsolidationService,
    fileLocks,
    selfWrites,
    coverStore as unknown as BookCoverStore,
    fileRename as unknown as FileRenameService,
  );
  return { executor, repository, consolidation, fileLocks, selfWrites, coverStore, fileRename, tx, journalSnapshots, consolidateSawTransaction };
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'bookorbit-merge-exec-'));
  libraryRoot = join(workDir, 'library');
  targetFolder = join(libraryRoot, 'Frank Herbert', 'Dune');
  await mkdir(targetFolder, { recursive: true });
  vi.mocked(moveFileBack).mockClear();
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(workDir, { recursive: true, force: true });
});

describe('BookMergeExecutor.run', () => {
  it('reports the bytes it moves, from none to all of them', async () => {
    const sourceFolder = join(libraryRoot, 'Frank Herbert', 'Dune Copy');
    const from = join(sourceFolder, 'Dune.mobi');
    const to = join(targetFolder, 'Dune.mobi');
    await writeBook(from, 'mobi bytes');
    const plan = planOf([stepOf(2, [await plannedMove(20, 2, from, to)], [sourceFolder])]);
    const { executor } = createExecutor();
    const onProgress = vi.fn();

    await executor.run(jobOf(plan), plan, onProgress);

    expect(onProgress).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: 'moving', bytesDone: 0, bytesTotal: 10 }));
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'committed', bytesDone: 10, bytesTotal: 10 }));
  });

  it('keeps the watchers of both libraries quiet while a book moves in from another library (X31)', async () => {
    const otherRoot = join(workDir, 'audiobooks');
    const sourceFolder = join(otherRoot, 'Frank Herbert', 'Dune');
    const from = join(sourceFolder, 'Dune.m4b');
    const to = join(targetFolder, 'Dune.m4b');
    await writeBook(from, 'audio bytes');
    const step = { ...stepOf(2, [await plannedMove(20, 2, from, to)], [sourceFolder]), roots: [libraryRoot, otherRoot] };
    const plan = { ...planOf([step]), libraryIds: [1, 2] };
    const { executor, consolidation, selfWrites } = createExecutor();
    const duringCommit: Record<string, boolean> = {};
    consolidation.consolidate.mockImplementationOnce(() => {
      for (const [name, path] of Object.entries({ from, sourceFolder, author: dirname(sourceFolder), to, targetFolder })) {
        duringCommit[name] = selfWrites.isSuppressed(path);
      }
      return Promise.resolve(consolidated());
    });

    await executor.run(jobOf(plan), plan, vi.fn());

    expect(duringCommit).toEqual({ from: true, sourceFolder: true, author: true, to: true, targetFolder: true });
    expect(selfWrites.isSuppressed(from)).toBe(false);
    expect(await readFile(to, 'utf8')).toBe('audio bytes');
  });

  it('journals each move before touching the disk, then commits the step in one transaction', async () => {
    const sourceFolder = join(libraryRoot, 'Frank Herbert', 'Dune Copy');
    const from = join(sourceFolder, 'Dune.mobi');
    const to = join(targetFolder, 'Dune.mobi');
    await writeBook(from, 'mobi bytes');
    const plan = planOf([stepOf(2, [await plannedMove(20, 2, from, to)], [sourceFolder])]);
    const { executor, repository, consolidation, selfWrites, tx, journalSnapshots, consolidateSawTransaction } = createExecutor();
    const onProgress = vi.fn();

    const result = await executor.run(jobOf(plan), plan, onProgress);

    expect(journalSnapshots).toEqual([
      { journal: [expect.objectContaining({ fileId: 20, from, to, phase: 'started' })], fromExists: true, toExists: false },
      { journal: [expect.objectContaining({ fileId: 20, phase: 'done', movedSize: 10 })], fromExists: false, toExists: true },
    ]);
    expect(repository.updateJob.mock.invocationCallOrder[0]).toBeLessThan(repository.setMoves.mock.invocationCallOrder[0]);
    expect(repository.updateJob).toHaveBeenNthCalledWith(1, 40, { status: 'moving', currentSourceBookId: 2, moves: [], outcomes: expect.any(Array) });

    expect(consolidateSawTransaction).toEqual([true]);
    expect(consolidation.consolidate).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        targetBookId: 1,
        sourceBookId: 2,
        destination: { libraryFolderId: 11, folderPath: targetFolder, libraryId: 1 },
        targetFileUpdates: [],
        sourceFileUpdates: [
          { fileId: 20, absolutePath: to, relPath: relative(libraryRoot, to), sizeBytes: 10, mtime: expect.any(Date), ino: expect.any(BigInt) },
        ],
        fieldSources: new Map([['title', 1]]),
        mergedByUserId: 7,
        jobId: 40,
      }),
    );
    expect(repository.updateJob).toHaveBeenCalledWith(40, { status: 'committing' }, tx);
    expect(repository.updateJob).toHaveBeenCalledWith(
      40,
      {
        status: 'committed',
        moves: [],
        outcomes: [{ sourceBookId: 2, status: 'merged', errorCode: null }],
        processed: 1,
        plan: expect.objectContaining({
          coverSlots: { '2': [] },
          readers: { '2': { affectedUserIds: [7], ratingChangedUserIds: [], koboEntitlementMovedUserIds: [] } },
        }),
      },
      tx,
    );

    expect(result).toEqual({
      outcomes: [{ sourceBookId: 2, status: 'merged', errorCode: null }],
      merged: [{ sourceBookId: 2, result: consolidated() }],
      movedFileCount: 1,
      crossDevice: false,
      rolledBack: false,
      failed: false,
      errorCode: null,
    });
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'committed', currentSourceBookId: 2, processed: 1 }));
    expect(await readFile(to, 'utf8')).toBe('mobi bytes');
    expect(existsSync(sourceFolder)).toBe(false);
    expect(selfWrites.isSuppressed(to)).toBe(false);
  });

  it('stops on FILE_CHANGED when a re-stat differs from the plan and moves the step back', async () => {
    const sourceFolder = join(libraryRoot, 'Frank Herbert', 'Dune Copy');
    const laterFolder = join(libraryRoot, 'Frank Herbert', 'Dune Later');
    const firstFrom = join(sourceFolder, 'Dune.mobi');
    const changedFrom = join(sourceFolder, 'Dune.azw3');
    const laterFrom = join(laterFolder, 'Dune.pdf');
    await writeBook(firstFrom, 'mobi bytes');
    await writeBook(changedFrom, 'azw3 bytes');
    await writeBook(laterFrom, 'pdf bytes');
    const changed = await plannedMove(21, 2, changedFrom, join(targetFolder, 'Dune.azw3'));
    const plan = planOf([
      stepOf(2, [
        await plannedMove(20, 2, firstFrom, join(targetFolder, 'Dune.mobi')),
        { ...changed, expectedMtimeMs: changed.expectedMtimeMs! - 5000 },
      ]),
      stepOf(3, [await plannedMove(30, 3, laterFrom, join(targetFolder, 'Dune.pdf'))]),
    ]);
    const { executor, repository, consolidation, coverStore } = createExecutor();

    const result = await executor.run(jobOf(plan), plan, vi.fn());

    expect(result).toMatchObject({ errorCode: 'FILE_CHANGED', rolledBack: true, failed: false, merged: [] });
    expect(result.outcomes).toEqual([
      { sourceBookId: 2, status: 'rolled_back', errorCode: 'FILE_CHANGED' },
      { sourceBookId: 3, status: 'pending', errorCode: null },
    ]);
    expect(await readFile(firstFrom, 'utf8')).toBe('mobi bytes');
    expect(existsSync(join(targetFolder, 'Dune.mobi'))).toBe(false);
    expect(await readFile(changedFrom, 'utf8')).toBe('azw3 bytes');
    expect(await readFile(laterFrom, 'utf8')).toBe('pdf bytes');
    expect(consolidation.consolidate).not.toHaveBeenCalled();
    expect(coverStore.slotsForAdoption).toHaveBeenCalledTimes(1);
    expect(repository.updateJob).toHaveBeenLastCalledWith(
      40,
      expect.objectContaining({ status: 'rolled_back', errorCode: 'FILE_CHANGED', moves: [] }),
    );
  });

  it('stops on PATH_CONFLICT when the target path is already taken, leaving the source in place', async () => {
    const from = join(libraryRoot, 'Frank Herbert', 'Dune Copy', 'Dune.mobi');
    const to = join(targetFolder, 'Dune.mobi');
    await writeBook(from, 'mobi bytes');
    const move = await plannedMove(20, 2, from, to);
    await writeBook(to, 'someone else');
    const plan = planOf([stepOf(2, [move])]);
    const { executor, consolidation } = createExecutor();

    const result = await executor.run(jobOf(plan), plan, vi.fn());

    expect(result).toMatchObject({ errorCode: 'PATH_CONFLICT', rolledBack: true, failed: false });
    expect(result.outcomes).toEqual([{ sourceBookId: 2, status: 'rolled_back', errorCode: 'PATH_CONFLICT' }]);
    expect(await readFile(from, 'utf8')).toBe('mobi bytes');
    expect(consolidation.consolidate).not.toHaveBeenCalled();
  });

  it('keeps the file that already occupied the target path when it stops on PATH_CONFLICT', async () => {
    const from = join(libraryRoot, 'Frank Herbert', 'Dune Copy', 'Dune.mobi');
    const to = join(targetFolder, 'Dune.mobi');
    await writeBook(from, 'mobi bytes');
    const move = await plannedMove(20, 2, from, to);
    await writeBook(to, 'someone else');
    const plan = planOf([stepOf(2, [move])]);
    const { executor, repository } = createExecutor();

    await executor.run(jobOf(plan), plan, vi.fn());

    expect(await readFile(to, 'utf8')).toBe('someone else');
    expect(await readFile(from, 'utf8')).toBe('mobi bytes');
    expect(repository.setMoves).not.toHaveBeenCalled();
  });

  it('moves every completed file of a step back, newest first, when the commit fails', async () => {
    const firstFolder = join(libraryRoot, 'Frank Herbert', 'Dune Copy');
    const secondFolder = join(libraryRoot, 'Frank Herbert', 'Dune Extras');
    const committedFrom = join(firstFolder, 'Dune.mobi');
    const names = ['Dune.azw3', 'Dune.pdf', 'Dune.cbz'];
    for (const name of names) await writeBook(join(secondFolder, name), name);
    await writeBook(committedFrom, 'mobi bytes');
    const secondMoves = await Promise.all(names.map((name, index) => plannedMove(30 + index, 3, join(secondFolder, name), join(targetFolder, name))));
    const plan = planOf([stepOf(2, [await plannedMove(20, 2, committedFrom, join(targetFolder, 'Dune.mobi'))]), stepOf(3, secondMoves)]);
    const { executor, repository, consolidation } = createExecutor();
    consolidation.consolidate.mockResolvedValueOnce(consolidated()).mockRejectedValueOnce(new Error('unique violation'));

    const result = await executor.run(jobOf(plan), plan, vi.fn());

    expect(vi.mocked(moveFileBack).mock.calls).toEqual([...secondMoves].reverse().map((move) => [move.to, move.from]));
    for (const name of names) {
      expect(await readFile(join(secondFolder, name), 'utf8')).toBe(name);
      expect(existsSync(join(targetFolder, name))).toBe(false);
    }
    expect(await readFile(join(targetFolder, 'Dune.mobi'), 'utf8')).toBe('mobi bytes');
    expect(result).toMatchObject({ errorCode: 'MERGE_FAILED', rolledBack: true, failed: false, merged: [{ sourceBookId: 2 }] });
    expect(result.outcomes).toEqual([
      { sourceBookId: 2, status: 'merged', errorCode: null },
      { sourceBookId: 3, status: 'rolled_back', errorCode: 'MERGE_FAILED' },
    ]);
    expect(repository.updateJob).toHaveBeenLastCalledWith(
      40,
      expect.objectContaining({ status: 'rolled_back', errorCode: 'MERGE_FAILED', moves: [] }),
    );
  });

  it('takes every book lock in ascending id order and holds them for the whole run', async () => {
    const plan = planOf([stepOf(9, []), stepOf(3, [])], 7);
    const { executor, fileLocks, fileRename, consolidation } = createExecutor();
    const withLock = vi.spyOn(fileLocks, 'withLock');
    const heldDuringCommit: boolean[] = [];
    consolidation.consolidate.mockImplementation(() => {
      heldDuringCommit.push(['book:3', 'book:7', 'book:9'].every((key) => fileLocks.isLocked(key)));
      return Promise.resolve(consolidated());
    });

    await executor.run(jobOf(plan), plan, vi.fn());

    expect(withLock.mock.calls.map(([key]) => key)).toEqual(['book:3', 'book:7', 'book:9']);
    expect(fileRename.cancelPendingRename.mock.calls).toEqual([[3], [7], [9]]);
    expect(heldDuringCommit).toEqual([true, true]);
    expect(['book:3', 'book:7', 'book:9'].some((key) => fileLocks.isLocked(key))).toBe(false);
  });
});
