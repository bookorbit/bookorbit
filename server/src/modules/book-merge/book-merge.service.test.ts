import { ConflictException, Logger, NotFoundException } from '@nestjs/common';

import type { BookMergeBlocker, BookMergePreviewResponse } from '@bookorbit/types';

import { LibraryOperationGate } from '../../common/services/library-operation-gate.service';
import type { RequestUser } from '../../common/types/request-user';
import type { ScanGateway } from '../scanner/scan.gateway';
import type { BookMergeEffectsService } from './book-merge-effects.service';
import type { BookMergeExecutor, MergeRunResult } from './book-merge.executor';
import type { BookMergePlanner, MergeExecutionPlan } from './book-merge.planner';
import type { BookMergeRepository, MergeJobRow } from './book-merge.repository';
import { BookMergeService } from './book-merge.service';
import type { BookMergeDto } from './dto/book-merge.dto';

function makeUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 1,
    username: 'reader',
    name: 'Reader',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 0,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    contentFilters: { includeTagIds: [], excludeTagIds: [], includeGenreIds: [], excludeGenreIds: [] },
    ...overrides,
  };
}

function planFor(libraryId: number): MergeExecutionPlan {
  return {
    libraryId,
    targetBookId: 1,
    destinationBookId: 1,
    destination: { libraryFolderId: 11, libraryFolderPath: '/library', folderPath: '/library/Dune' },
    steps: [{ sourceBookId: 2, moves: [], targetFileIds: [], droppedSidecarFileIds: [], vacatedFolders: [], roots: ['/library'] }],
    fieldSources: {},
    excludeTagIds: [],
    excludeGenreIds: [],
    hiddenRequestIds: [],
    identicalPairs: [],
    deleteIdenticalCopies: false,
    watched: false,
  };
}

function previewWith(blockers: BookMergeBlocker[], previewToken: string | null): BookMergePreviewResponse {
  return { blockers, warnings: [], previewToken, eligible: blockers.length === 0 } as unknown as BookMergePreviewResponse;
}

function jobRow(id: number, overrides: Partial<MergeJobRow> = {}): MergeJobRow {
  return {
    id,
    libraryId: 1,
    libraryIds: null,
    targetBookId: 1,
    destinationBookId: 1,
    sourceBookIds: [2, 3],
    requestedByUserId: 1,
    status: 'planned',
    plan: {},
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

function runResult(): MergeRunResult {
  return { outcomes: [], merged: [], movedFileCount: 0, crossDevice: false, rolledBack: false, failed: false, errorCode: null };
}

const DTO: BookMergeDto = { targetBookId: 1, sourceBookIds: [2], previewToken: 'token' } as BookMergeDto;

function createService() {
  let nextJobId = 1;
  const repository = {
    findInFlightJob: vi.fn().mockResolvedValue(null),
    createJob: vi.fn((values: Partial<MergeJobRow>) => Promise.resolve(jobRow(nextJobId++, values))),
    findJob: vi.fn().mockResolvedValue(null),
    updateJob: vi.fn().mockResolvedValue(undefined),
  };
  const planner = { plan: vi.fn().mockResolvedValue({ preview: previewWith([], 'token'), plan: planFor(1) }) };
  const executor = { run: vi.fn().mockResolvedValue(runResult()) };
  const effects = { apply: vi.fn().mockResolvedValue(0) };
  const libraryGate = new LibraryOperationGate();
  const gateway = { emitBookMerged: vi.fn(), emitBookMergeJob: vi.fn() };
  const service = new BookMergeService(
    repository as unknown as BookMergeRepository,
    planner as unknown as BookMergePlanner,
    executor as unknown as BookMergeExecutor,
    effects as unknown as BookMergeEffectsService,
    libraryGate,
    gateway as unknown as ScanGateway,
  );
  return { service, repository, planner, executor, effects, libraryGate, gateway };
}

async function conflictOf(promise: Promise<unknown>): Promise<Record<string, unknown>> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ConflictException);
  return (error as ConflictException).getResponse() as Record<string, unknown>;
}

function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BookMergeService.start', () => {
  it('refuses with MERGE_IN_PROGRESS while the same merge is in flight, before planning', async () => {
    const { service, repository, planner } = createService();
    repository.findInFlightJob.mockResolvedValue(jobRow(9));

    const response = await conflictOf(service.start(DTO, makeUser()));

    expect(response).toMatchObject({ errorCode: 'MERGE_IN_PROGRESS', errorMeta: { jobId: 9 } });
    expect(repository.findInFlightJob).toHaveBeenCalledWith(1, 1, [2]);
    expect(planner.plan).not.toHaveBeenCalled();
  });

  it('refuses with MERGE_BLOCKED and the blockers when the plan is not eligible', async () => {
    const { service, planner, repository } = createService();
    const blockers: BookMergeBlocker[] = [{ code: 'SAME_BOOK' }, { code: 'BOOK_BUSY', bookId: 2 }];
    planner.plan.mockResolvedValue({ preview: previewWith(blockers, null), plan: null });

    const response = await conflictOf(service.start(DTO, makeUser()));

    expect(response).toMatchObject({ errorCode: 'MERGE_BLOCKED', errorMeta: { blockers } });
    expect(repository.createJob).not.toHaveBeenCalled();
  });

  it('refuses with LIBRARY_BUSY when the library is the blocker', async () => {
    const { service, planner } = createService();
    planner.plan.mockResolvedValue({ preview: previewWith([{ code: 'SAME_BOOK' }, { code: 'LIBRARY_BUSY' }], null), plan: null });

    const response = await conflictOf(service.start(DTO, makeUser()));

    expect(response).toMatchObject({ errorCode: 'LIBRARY_BUSY' });
  });

  it('refuses with MERGE_PREVIEW_STALE when the token no longer matches, without taking the library', async () => {
    const { service, planner, libraryGate, repository } = createService();
    planner.plan.mockResolvedValue({ preview: previewWith([], 'fresh'), plan: planFor(1) });
    const tryAcquire = vi.spyOn(libraryGate, 'tryAcquire');

    const response = await conflictOf(service.start({ ...DTO, previewToken: 'stale' } as BookMergeDto, makeUser()));

    expect(response).toMatchObject({ errorCode: 'MERGE_PREVIEW_STALE' });
    expect(tryAcquire).not.toHaveBeenCalled();
    expect(repository.createJob).not.toHaveBeenCalled();
  });

  it('refuses with LIBRARY_BUSY when the library gate is taken after planning', async () => {
    const { service, libraryGate, repository } = createService();
    libraryGate.tryAcquire(1, 'scan');

    const response = await conflictOf(service.start(DTO, makeUser()));

    expect(response).toMatchObject({ errorCode: 'LIBRARY_BUSY' });
    expect(repository.createJob).not.toHaveBeenCalled();
    expect(libraryGate.current(1)).toBe('scan');
  });

  it('releases the library gate when the job cannot be created', async () => {
    const { service, repository, libraryGate, executor } = createService();
    repository.createJob.mockRejectedValue(new Error('insert failed'));

    await expect(service.start(DTO, makeUser())).rejects.toThrow('insert failed');

    expect(libraryGate.isHeld(1)).toBe(false);
    expect(executor.run).not.toHaveBeenCalled();
  });

  it('creates a planned job, runs it and releases the library when it finishes', async () => {
    const { service, repository, executor, effects, libraryGate } = createService();
    const user = makeUser({ id: 5 });

    await expect(service.start(DTO, user)).resolves.toEqual({ jobId: 1, libraryIds: [1] });

    expect(repository.createJob).toHaveBeenCalledWith(
      expect.objectContaining({ libraryId: 1, targetBookId: 1, sourceBookIds: [2], requestedByUserId: 5, status: 'planned', total: 1 }),
    );
    await vi.waitFor(() => expect(libraryGate.isHeld(1)).toBe(false));
    expect(executor.run).toHaveBeenCalledTimes(1);
    expect(effects.apply).toHaveBeenCalledTimes(1);
    expect(repository.updateJob).toHaveBeenCalledWith(1, expect.objectContaining({ status: 'done', currentSourceBookId: null }));
  });

  it('runs at most two merges at once; a third waits, keeping its library, until one finishes', async () => {
    const { service, planner, executor, libraryGate } = createService();
    const finishers: Array<() => void> = [];
    executor.run.mockImplementation(() => new Promise<MergeRunResult>((resolve) => finishers.push(() => resolve(runResult()))));
    for (const libraryId of [1, 2, 3]) {
      planner.plan.mockResolvedValueOnce({ preview: previewWith([], 'token'), plan: planFor(libraryId) });
    }

    for (let started = 0; started < 3; started++) await service.start(DTO, makeUser());
    for (let tick = 0; tick < 5; tick++) await settle();

    expect(executor.run).toHaveBeenCalledTimes(2);
    expect(libraryGate.isHeld(3)).toBe(true);

    finishers[0]();
    await vi.waitFor(() => expect(executor.run).toHaveBeenCalledTimes(3));
    expect(executor.run.mock.calls[2][0]).toMatchObject({ id: 3, libraryId: 3 });
    await vi.waitFor(() => expect(libraryGate.isHeld(1)).toBe(false));

    finishers[1]();
    finishers[2]();
    await vi.waitFor(() => expect(libraryGate.isHeld(2) || libraryGate.isHeld(3)).toBe(false));
  });
});

describe('BookMergeService across libraries', () => {
  function crossLibraryPlan(): MergeExecutionPlan {
    return { ...planFor(1), libraryIds: [1, 2] };
  }

  function narrowingPreview(): BookMergePreviewResponse {
    return { ...previewWith([], 'token'), warnings: [{ code: 'LIBRARY_ACCESS_NARROWS', libraryId: 1, count: 2 }] };
  }

  it('refuses a merge that cuts other readers off until the request confirms it', async () => {
    const { service, planner, repository } = createService();
    planner.plan.mockResolvedValue({ preview: narrowingPreview(), plan: crossLibraryPlan() });

    const response = await conflictOf(service.start(DTO, makeUser()));

    expect(response).toMatchObject({ errorCode: 'ACCESS_LOSS_NOT_ACKNOWLEDGED' });
    expect(repository.createJob).not.toHaveBeenCalled();
  });

  it('takes every involved library and records them on the job once the loss is confirmed', async () => {
    const { service, planner, repository, libraryGate, executor } = createService();
    planner.plan.mockResolvedValue({ preview: narrowingPreview(), plan: crossLibraryPlan() });
    let heldDuringRun: boolean[] = [];
    executor.run.mockImplementation(() => {
      heldDuringRun = [libraryGate.isHeld(1), libraryGate.isHeld(2)];
      return Promise.resolve(runResult());
    });

    await service.start({ ...DTO, acknowledgeAccessLoss: true } as BookMergeDto, makeUser());

    expect(repository.createJob).toHaveBeenCalledWith(expect.objectContaining({ libraryId: 1, libraryIds: [1, 2] }));
    await vi.waitFor(() => expect(libraryGate.isHeld(2)).toBe(false));
    expect(heldDuringRun).toEqual([true, true]);
  });

  it('refuses with LIBRARY_BUSY when any involved library is taken', async () => {
    const { service, planner, libraryGate, repository } = createService();
    planner.plan.mockResolvedValue({ preview: previewWith([], 'token'), plan: crossLibraryPlan() });
    libraryGate.tryAcquire(2, 'scan');

    const response = await conflictOf(service.start(DTO, makeUser()));

    expect(response).toMatchObject({ errorCode: 'LIBRARY_BUSY' });
    expect(repository.createJob).not.toHaveBeenCalled();
    expect(libraryGate.isHeld(1)).toBe(false);
  });

  it('tells every involved library room that the books merged', async () => {
    const { service, planner, executor, gateway } = createService();
    planner.plan.mockResolvedValue({ preview: previewWith([], 'token'), plan: crossLibraryPlan() });
    executor.run.mockResolvedValue({ ...runResult(), merged: [{ sourceBookId: 2, result: {} as never }] });

    await service.start(DTO, makeUser());

    await vi.waitFor(() => expect(gateway.emitBookMerged).toHaveBeenCalled());
    expect(gateway.emitBookMerged).toHaveBeenCalledWith({ libraryId: 1, targetBookId: 1, sourceBookIds: [2], sourceLibraryIds: [2] });
  });

  it('sends the bytes moved with the progress', async () => {
    const { service, planner, executor, gateway } = createService();
    planner.plan.mockResolvedValue({ preview: previewWith([], 'token'), plan: crossLibraryPlan() });
    executor.run.mockImplementation((_job: unknown, _plan: unknown, onProgress: (change: object) => void) => {
      onProgress({ status: 'moving', bytesDone: 400, bytesTotal: 1000 });
      return Promise.resolve(runResult());
    });

    await service.start(DTO, makeUser({ id: 5 }));

    await vi.waitFor(() =>
      expect(gateway.emitBookMergeJob).toHaveBeenCalledWith(5, 'progress', expect.objectContaining({ bytesDone: 400, bytesTotal: 1000 })),
    );
  });

  it('never lets a bulk run cut other readers off: nobody confirmed that plan', async () => {
    const { service, planner, libraryGate, repository } = createService();
    planner.plan.mockResolvedValue({ preview: narrowingPreview(), plan: crossLibraryPlan() });
    const lease = libraryGate.tryAcquireLease([1, 2], 'book_merge')!;

    const result = await service.mergeWithinLease({ targetBookId: 1, sourceBookIds: [2] }, makeUser(), lease);

    expect(result).toMatchObject({ status: 'blocked', blockers: [{ code: 'READERS_LOSE_ACCESS', libraryId: 1 }] });
    expect(repository.createJob).not.toHaveBeenCalled();
    lease.release();
  });

  it('refuses a bulk merge into a library the lease does not cover', async () => {
    const { service, planner, libraryGate } = createService();
    planner.plan.mockResolvedValue({ preview: previewWith([], 'token'), plan: crossLibraryPlan() });
    const lease = libraryGate.tryAcquireLease([1], 'book_merge')!;

    const result = await service.mergeWithinLease({ targetBookId: 1, sourceBookIds: [2] }, makeUser(), lease);

    expect(result).toMatchObject({ status: 'blocked', blockers: [{ code: 'LIBRARY_BUSY', libraryId: 2 }] });
    lease.release();
  });
});

describe('BookMergeService.getJob', () => {
  it("answers 404 for another user's job", async () => {
    const { service, repository } = createService();
    repository.findJob.mockResolvedValue(jobRow(4, { requestedByUserId: 2 }));

    await expect(service.getJob(4, makeUser({ id: 1 }))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers 404 for a job that does not exist', async () => {
    const { service } = createService();

    await expect(service.getJob(4, makeUser())).rejects.toBeInstanceOf(NotFoundException);
  });

  it("shows a superuser another user's job, with pending outcomes before any step ran", async () => {
    const { service, repository } = createService();
    repository.findJob.mockResolvedValue(jobRow(4, { requestedByUserId: 2, status: 'moving', currentSourceBookId: 2 }));

    const job = await service.getJob(4, makeUser({ id: 1, isSuperuser: true }));

    expect(job).toEqual({
      id: 4,
      libraryId: 1,
      targetBookId: 1,
      sourceBookIds: [2, 3],
      status: 'moving',
      processed: 0,
      total: 2,
      currentSourceBookId: 2,
      outcomes: [
        { sourceBookId: 2, status: 'pending', errorCode: null },
        { sourceBookId: 3, status: 'pending', errorCode: null },
      ],
      result: null,
      errorCode: null,
      createdAt: '2026-11-01T10:00:00.000Z',
      finishedAt: null,
    });
  });

  it('shows users their own job', async () => {
    const { service, repository } = createService();
    repository.findJob.mockResolvedValue(jobRow(4, { requestedByUserId: 1 }));

    await expect(service.getJob(4, makeUser({ id: 1 }))).resolves.toMatchObject({ id: 4 });
  });
});
