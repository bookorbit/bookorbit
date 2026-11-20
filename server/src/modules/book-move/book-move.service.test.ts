import type { Mock } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

import type { AccessLevel, BookMoveProgressEvent, BookMoveSummary } from '@bookorbit/types';
import { LibraryScopeService } from '../../common/library-scope/library-scope.service';
import { LibraryOperationGate } from '../../common/services/library-operation-gate.service';
import type { RequestUser } from '../../common/types/request-user';
import type { BulkRunRow } from '../../db/schema';
import type { BulkRunEnd } from '../bulk-runs/bulk-run-handler';
import { BookMovePlannerService } from './book-move-planner.service';
import { BookMoveService, bookMoveDoneEvent, type BookMoveRunPlan, type BookMoveRunState } from './book-move.service';
import type { MoveBookData, MoveTargetLibrary } from './book-move.repository';
import type { MoveBooksDto } from './dto/move-books.dto';

const USER: RequestUser = { id: 7, username: 'reader', isSuperuser: false } as RequestUser;
const SUPERUSER: RequestUser = { id: 1, username: 'admin', isSuperuser: true } as RequestUser;

function makeTarget(overrides: Partial<MoveTargetLibrary> = {}): MoveTargetLibrary {
  return {
    libraryId: 2,
    libraryName: 'Manga',
    organizationMode: 'book_per_folder',
    fileNamingPattern: '<{title}>/<{title}>',
    allowedFormats: [],
    folderId: 22,
    folderPath: '/libB',
    watch: true,
    ...overrides,
  };
}

function makeBook(overrides: Partial<MoveBookData> = {}): MoveBookData {
  return {
    bookId: 1,
    status: 'present',
    libraryId: 1,
    libraryFolderId: 11,
    libraryFolderPath: '/libA',
    organizationMode: 'book_per_folder',
    folderPath: '/libA/Dune',
    primaryFileId: 10,
    title: 'Dune',
    metadata: {
      title: 'Dune',
      subtitle: null,
      publisher: null,
      language: null,
      isbn10: null,
      isbn13: null,
      publishedYear: null,
      seriesName: null,
      seriesIndex: null,
    },
    authors: [],
    files: [{ id: 10, absolutePath: '/libA/Dune/Dune.epub', relPath: null, role: 'content', format: 'epub', fileHash: null, sortOrder: null }],
    ...overrides,
  };
}

function makeDto(overrides: Partial<MoveBooksDto> = {}): MoveBooksDto {
  return {
    selection: { bookIds: [1] },
    targetLibraryId: 2,
    targetFolderId: 22,
    collisionPolicy: 'keep_both',
    ...overrides,
  } as MoveBooksDto;
}

let moveRepo: Record<string, Mock<(...args: unknown[]) => unknown>>;
type ExecuteResult = { status: string; crossDevice?: boolean; reason?: string; mergedBookId?: number | null };
let executor: { execute: Mock<(input: unknown) => Promise<ExecuteResult>> };
let bookService: { resolveSelectionToIds: ReturnType<typeof vi.fn> };
let appSettings: Record<string, ReturnType<typeof vi.fn>>;
let scannerService: { isScanRunning: ReturnType<typeof vi.fn>; startScanAsync: ReturnType<typeof vi.fn> };
let fileWatcherService: { stopWatcher: ReturnType<typeof vi.fn>; startWatcher: ReturnType<typeof vi.fn> };
let scanGateway: { emitBookTransferred: ReturnType<typeof vi.fn> };
let notificationService: { notify: ReturnType<typeof vi.fn> };
let service: BookMoveService;
let libraryGate: LibraryOperationGate;

type GrantRow = { libraryId: number; userId: number; accessLevel: AccessLevel };

/** Reads the grant rows each test hands the move repository, so one fixture drives both. */
function scopeFromGrants(): LibraryScopeService {
  const grants = async () => (await moveRepo.findLibraryAccess([])) as GrantRow[];
  return new LibraryScopeService({
    findAllIds: () => Promise.resolve([1, 2, 3]),
    findGrantedLevels: async (userId: number, levels?: readonly AccessLevel[]) =>
      (await grants())
        .filter((row) => row.userId === userId && (!levels || levels.includes(row.accessLevel)))
        .map((row) => ({ id: row.libraryId, accessLevel: row.accessLevel })),
  } as never);
}

function buildService(): BookMoveService {
  return new BookMoveService(
    moveRepo as never,
    new BookMovePlannerService(),
    executor as never,
    bookService as never,
    appSettings as never,
    scannerService as never,
    fileWatcherService as never,
    scanGateway as never,
    notificationService as never,
    libraryGate,
    scopeFromGrants(),
  );
}

function makeRun(plan: BookMoveRunPlan, overrides: Partial<BulkRunRow> = {}): BulkRunRow {
  const now = new Date();
  return {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'book-move',
    requestedBy: USER.id,
    credentialKind: 'session',
    apiKeyId: null,
    status: 'running',
    subjectIds: plan.subjectIds,
    options: plan.options,
    total: plan.subjectIds.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    stats: {},
    failures: [],
    errorCode: null,
    error: null,
    cancelRequested: false,
    actorUsername: USER.username,
    actorIp: null,
    createdAt: now,
    startedAt: now,
    finishedAt: null,
    dismissedAt: null,
    ...overrides,
  };
}

interface RunMoveResult {
  run: BulkRunRow;
  state: BookMoveRunState | null;
  events: BookMoveProgressEvent[];
  summary: BookMoveSummary;
}

/** Drives a move the way the bulk-run dispatcher does: plan at creation, prepare, one book at a time, finish. */
async function runMove(
  dto: MoveBooksDto = makeDto(),
  user: RequestUser = USER,
  options: { cancelWhen?: () => boolean; end?: BulkRunEnd; error?: string } = {},
): Promise<RunMoveResult> {
  const plan = await service.planRun(dto, user);
  const run = makeRun(plan, { requestedBy: user.id });
  const events: BookMoveProgressEvent[] = [];
  let state: BookMoveRunState | null = null;
  if (plan.subjectIds.length > 0) {
    const prepared = await service.prepareRun(run, user);
    if (prepared === 'busy') throw new Error('busy');
    state = prepared.state;
    let end: BulkRunEnd = options.end ?? 'completed';
    for (const bookId of run.subjectIds.slice(run.processed)) {
      if (options.cancelWhen?.()) {
        end = 'cancelled';
        break;
      }
      const outcome = await service.moveOne(bookId, state, user);
      run.processed++;
      if (outcome.outcome === 'succeeded') run.succeeded++;
      else if (outcome.outcome === 'failed') run.failed++;
      else run.skipped++;
      for (const [key, amount] of Object.entries(outcome.stats ?? {})) run.stats = { ...run.stats, [key]: (run.stats[key] ?? 0) + amount };
      if (outcome.event) events.push(outcome.event as BookMoveProgressEvent);
    }
    run.status = end;
    if (end === 'failed') run.error = options.error ?? 'failed';
    await service.finishRun(run, state, end);
  } else {
    run.status = 'completed';
  }
  const done = bookMoveDoneEvent(run) as { done: true } & BookMoveSummary;
  const summary: BookMoveSummary = {
    processed: done.processed,
    succeeded: done.succeeded,
    merged: done.merged,
    failed: done.failed,
    skipped: done.skipped,
    cancelled: done.cancelled,
  };
  return { run, state, events, summary };
}

function twoBooks(): MoveBookData[] {
  return [
    makeBook({
      bookId: 1,
      folderPath: '/libA/One',
      files: [{ id: 10, absolutePath: '/libA/One/a.epub', relPath: null, role: 'content', format: 'epub', fileHash: null, sortOrder: null }],
    }),
    makeBook({
      bookId: 2,
      folderPath: '/libA/Two',
      metadata: { ...makeBook().metadata, title: 'Two' },
      files: [{ id: 20, absolutePath: '/libA/Two/b.epub', relPath: null, role: 'content', format: 'epub', fileHash: null, sortOrder: null }],
    }),
  ];
}

beforeEach(() => {
  moveRepo = {
    findTargetLibrary: vi.fn().mockResolvedValue(makeTarget()),
    findMoveBookData: vi.fn().mockResolvedValue([makeBook()]),
    findFolderPathOwners: vi.fn().mockResolvedValue(new Map()),
    findFilePathOwners: vi.fn().mockResolvedValue(new Map()),
    findHashOwnersInLibrary: vi.fn().mockResolvedValue(new Map()),
    findLibraryAccess: vi.fn().mockResolvedValue([
      { libraryId: 1, userId: 7, accessLevel: 'editor' },
      { libraryId: 2, userId: 7, accessLevel: 'editor' },
    ]),
    findUsers: vi.fn().mockResolvedValue([]),
    countKoboDevicesByUser: vi.fn().mockResolvedValue(new Map()),
    createJob: vi.fn().mockResolvedValue(101),
    finishJob: vi.fn().mockResolvedValue(undefined),
    markInterruptedJobs: vi.fn().mockResolvedValue([]),
    findLibraryFolders: vi.fn().mockResolvedValue([
      { libraryId: 1, path: '/libA' },
      { libraryId: 2, path: '/libB' },
    ]),
    findWatchedLibraryIds: vi.fn().mockResolvedValue([1, 2]),
    applyBookMove: vi.fn(),
  };
  executor = { execute: vi.fn<(input: unknown) => Promise<ExecuteResult>>().mockResolvedValue({ status: 'success', crossDevice: false }) };
  bookService = { resolveSelectionToIds: vi.fn().mockResolvedValue([1]) };
  appSettings = {
    getUploadPattern: vi.fn().mockResolvedValue('<{title}>'),
    getUploadPatternBookPerFolder: vi.fn().mockResolvedValue('<{title}>/<{title}>'),
    isCrossPlatformPathSanitizationEnabled: vi.fn().mockResolvedValue(false),
  };
  scannerService = { isScanRunning: vi.fn().mockReturnValue(false), startScanAsync: vi.fn() };
  libraryGate = new LibraryOperationGate();
  fileWatcherService = { stopWatcher: vi.fn().mockResolvedValue(undefined), startWatcher: vi.fn().mockResolvedValue(undefined) };
  scanGateway = { emitBookTransferred: vi.fn() };
  notificationService = { notify: vi.fn().mockResolvedValue(undefined) };
  service = buildService();
});

describe('access control', () => {
  it('requires editor access on the target library', async () => {
    moveRepo.findLibraryAccess.mockResolvedValue([
      { libraryId: 1, userId: 7, accessLevel: 'editor' },
      { libraryId: 2, userId: 7, accessLevel: 'viewer' },
    ]);

    await expect(service.preview(makeDto(), USER)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires editor access on every source library', async () => {
    moveRepo.findLibraryAccess.mockResolvedValue([
      { libraryId: 1, userId: 7, accessLevel: 'viewer' },
      { libraryId: 2, userId: 7, accessLevel: 'owner' },
    ]);

    await expect(service.preview(makeDto(), USER)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('accepts owner access as sufficient', async () => {
    moveRepo.findLibraryAccess.mockResolvedValue([
      { libraryId: 1, userId: 7, accessLevel: 'owner' },
      { libraryId: 2, userId: 7, accessLevel: 'owner' },
    ]);

    await expect(service.preview(makeDto(), USER)).resolves.toBeDefined();
  });

  it('lets a superuser bypass per-library access', async () => {
    moveRepo.findLibraryAccess.mockResolvedValue([]);

    await expect(service.preview(makeDto(), SUPERUSER)).resolves.toBeDefined();
  });

  it('rejects an unknown target folder', async () => {
    moveRepo.findTargetLibrary.mockResolvedValue(null);

    await expect(service.preview(makeDto(), USER)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('preview', () => {
  it('summarises a clean move without demanding review', async () => {
    const result = await service.preview(makeDto(), USER);

    expect(result).toMatchObject({
      targetLibraryId: 2,
      targetFolderId: 22,
      readyCount: 1,
      collisionCount: 0,
      ineligibleCount: 0,
      requiresReview: false,
    });
  });

  it('demands review when a book is ineligible', async () => {
    moveRepo.findMoveBookData.mockResolvedValue([makeBook({ status: 'missing' })]);

    const result = await service.preview(makeDto(), USER);

    expect(result.ineligibleCount).toBe(1);
    expect(result.requiresReview).toBe(true);
  });

  it('demands review when a destination collides', async () => {
    moveRepo.findFolderPathOwners.mockResolvedValue(new Map([['/libB/Dune', 99]]));

    const result = await service.preview(makeDto(), USER);

    expect(result.collisionCount).toBe(1);
    expect(result.collisions[0]).toMatchObject({ kind: 'folder_path', existingBookId: 99, suggestedPolicy: 'keep_both' });
    expect(result.requiresReview).toBe(true);
  });

  it('counts books already in the target library separately', async () => {
    moveRepo.findMoveBookData.mockResolvedValue([makeBook({ libraryId: 2, libraryFolderId: 22 })]);

    const result = await service.preview(makeDto(), USER);

    expect(result).toMatchObject({ alreadyInTargetCount: 1, readyCount: 0 });
  });

  it('names the users who lose visibility, ignoring superusers', async () => {
    moveRepo.findLibraryAccess.mockResolvedValue([
      { libraryId: 1, userId: 7, accessLevel: 'editor' },
      { libraryId: 2, userId: 7, accessLevel: 'editor' },
      { libraryId: 1, userId: 8, accessLevel: 'viewer' },
      { libraryId: 1, userId: 9, accessLevel: 'viewer' },
    ]);
    moveRepo.findUsers.mockResolvedValue([
      { id: 8, username: 'sarah', isSuperuser: false },
      { id: 9, username: 'root', isSuperuser: true },
    ]);

    const result = await service.preview(makeDto(), USER);

    expect(result.warnings.accessLosers).toEqual([{ userId: 8, username: 'sarah', bookCount: 1 }]);
    expect(result.requiresReview).toBe(true);
  });

  it('reports Kobo impact only for affected users who own devices', async () => {
    moveRepo.findLibraryAccess.mockResolvedValue([
      { libraryId: 1, userId: 7, accessLevel: 'editor' },
      { libraryId: 2, userId: 7, accessLevel: 'editor' },
      { libraryId: 1, userId: 8, accessLevel: 'viewer' },
    ]);
    moveRepo.findUsers.mockResolvedValue([{ id: 8, username: 'sarah', isSuperuser: false }]);
    moveRepo.countKoboDevicesByUser.mockResolvedValue(new Map([[8, 2]]));

    const result = await service.preview(makeDto(), USER);

    expect(result.warnings.koboImpact).toEqual([{ userId: 8, username: 'sarah', deviceCount: 2, bookCount: 1 }]);
  });

  it('flags a format the target library does not allow', async () => {
    moveRepo.findTargetLibrary.mockResolvedValue(makeTarget({ allowedFormats: ['pdf'] }));

    const result = await service.preview(makeDto(), USER);

    expect(result.warnings.formatMismatches).toEqual([{ bookId: 1, title: 'Dune', format: 'epub' }]);
  });

  it('reports the layout change when organization modes differ', async () => {
    moveRepo.findMoveBookData.mockResolvedValue([
      makeBook({
        organizationMode: 'book_per_file',
        folderPath: '/libA/Dune.epub',
        files: [{ id: 10, absolutePath: '/libA/Dune.epub', relPath: null, role: 'content', format: 'epub', fileHash: null, sortOrder: null }],
      }),
    ]);

    const result = await service.preview(makeDto(), USER);

    expect(result.warnings.layout).toEqual({ change: 'wrap_into_folder', bookCount: 1 });
    expect(result.requiresReview).toBe(true);
  });

  it('rejects an empty selection', async () => {
    bookService.resolveSelectionToIds.mockResolvedValue([]);

    await expect(service.preview(makeDto(), USER)).rejects.toThrow(/No books matched/);
  });
});

describe('creating a run', () => {
  it('refuses when a scan is running on any involved library', async () => {
    const releaseScan = libraryGate.tryAcquire(1, 'scan');

    await expect(service.planRun(makeDto(), USER)).rejects.toThrow(/scan is running/);
    expect(fileWatcherService.stopWatcher).not.toHaveBeenCalled();
    expect(libraryGate.current(2)).toBeNull();

    releaseScan?.();
  });

  it('refuses while a merge or bulk rename holds a library and leaves the other library free', async () => {
    const releaseMerge = libraryGate.tryAcquire(2, 'book_merge');

    await expect(service.planRun(makeDto(), USER)).rejects.toBeInstanceOf(ConflictException);
    expect(libraryGate.current(1)).toBeNull();

    releaseMerge?.();
  });

  it('only checks the gate, leaving every library free for the run to take', async () => {
    const plan = await service.planRun(makeDto(), USER);

    expect(plan).toEqual({
      subjectIds: [1],
      options: { targetLibraryId: 2, targetFolderId: 22, collisionPolicy: 'keep_both', overrides: [], sourceLibraryIds: [1] },
    });
    expect(libraryGate.current(1)).toBeNull();
    expect(libraryGate.current(2)).toBeNull();
    expect(moveRepo.createJob).not.toHaveBeenCalled();
  });

  it('keeps only the overrides for books the run will move', async () => {
    const plan = await service.planRun(
      makeDto({
        overrides: [
          { bookId: 1, policy: 'skip' },
          { bookId: 9, policy: 'merge' },
        ],
      }),
      USER,
    );

    expect(plan.subjectIds).toEqual([1]);
    expect(plan.options.overrides).toEqual([{ bookId: 1, policy: 'skip' }]);
  });

  it('leaves out books already in the target folder and ineligible ones', async () => {
    bookService.resolveSelectionToIds.mockResolvedValue([1, 2, 3]);
    moveRepo.findMoveBookData.mockResolvedValue([
      makeBook({ bookId: 1 }),
      makeBook({ bookId: 2, libraryId: 2, libraryFolderId: 22 }),
      makeBook({ bookId: 3, status: 'missing' }),
    ]);

    const plan = await service.planRun(makeDto(), USER);

    expect(plan.subjectIds).toEqual([1]);
  });
});

describe('starting a run', () => {
  it('waits in line without planning while a library is held', async () => {
    const plan = await service.planRun(makeDto(), USER);
    const releaseScan = libraryGate.tryAcquire(1, 'scan');
    moveRepo.findMoveBookData.mockClear();

    await expect(service.prepareRun(makeRun(plan), USER)).resolves.toBe('busy');
    expect(moveRepo.findMoveBookData).not.toHaveBeenCalled();
    expect(moveRepo.createJob).not.toHaveBeenCalled();
    expect(libraryGate.current(2)).toBeNull();

    releaseScan?.();
  });

  it('waits in line when a book moved meanwhile into a library another operation holds', async () => {
    const plan = await service.planRun(makeDto(), USER);
    moveRepo.findMoveBookData.mockResolvedValue([
      makeBook({ libraryId: 3, libraryFolderId: 33, libraryFolderPath: '/libC', folderPath: '/libC/Dune' }),
    ]);
    moveRepo.findLibraryAccess.mockResolvedValue([
      { libraryId: 1, userId: 7, accessLevel: 'editor' },
      { libraryId: 2, userId: 7, accessLevel: 'editor' },
      { libraryId: 3, userId: 7, accessLevel: 'editor' },
    ]);
    const releaseScan = libraryGate.tryAcquire(3, 'scan');

    await expect(service.prepareRun(makeRun(plan), USER)).resolves.toBe('busy');
    expect(libraryGate.current(1)).toBeNull();
    expect(libraryGate.current(2)).toBeNull();
    expect(moveRepo.createJob).not.toHaveBeenCalled();

    releaseScan?.();
  });

  it('holds every library from the start until the run finishes', async () => {
    const plan = await service.planRun(makeDto(), USER);
    const prepared = await service.prepareRun(makeRun(plan), USER);
    if (prepared === 'busy') throw new Error('busy');

    expect(service.isBusy(1)).toBe(true);
    expect(service.isBusy(2)).toBe(true);
    await expect(service.planRun(makeDto(), USER)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.prepareRun(makeRun(plan), USER)).resolves.toBe('busy');

    await service.finishRun(makeRun(plan, { status: 'completed' }), prepared.state, 'completed');
    expect(service.isBusy(1)).toBe(false);
    expect(service.isBusy(2)).toBe(false);
  });

  it('frees the libraries when the job row cannot be created', async () => {
    const plan = await service.planRun(makeDto(), USER);
    moveRepo.createJob.mockRejectedValueOnce(new Error('db down'));

    await expect(service.prepareRun(makeRun(plan), USER)).rejects.toThrow('db down');
    expect(libraryGate.current(1)).toBeNull();
    expect(libraryGate.current(2)).toBeNull();
  });

  it('frees the libraries and closes the job when the watchers cannot be stopped', async () => {
    const plan = await service.planRun(makeDto(), USER);
    moveRepo.findWatchedLibraryIds.mockRejectedValueOnce(new Error('db down'));

    await expect(service.prepareRun(makeRun(plan), USER)).rejects.toThrow('db down');
    expect(libraryGate.current(1)).toBeNull();
    expect(libraryGate.current(2)).toBeNull();
    expect(moveRepo.finishJob).toHaveBeenCalledWith(101, 'failed', { succeeded: 0, merged: 0, failed: 0, skipped: 0 }, 'db down');
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('restarts a watcher it stopped before another one failed to stop', async () => {
    const plan = await service.planRun(makeDto(), USER);
    fileWatcherService.stopWatcher.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('close failed'));

    await expect(service.prepareRun(makeRun(plan), USER)).rejects.toThrow('close failed');
    expect(libraryGate.current(1)).toBeNull();
    expect(libraryGate.current(2)).toBeNull();
    expect(fileWatcherService.startWatcher).toHaveBeenCalledWith(1, ['/libA']);
    expect(fileWatcherService.startWatcher).toHaveBeenCalledWith(2, ['/libB']);
  });

  it('fails the run when the account lost editor access to the target', async () => {
    const plan = await service.planRun(makeDto(), USER);
    moveRepo.findLibraryAccess.mockResolvedValue([{ libraryId: 1, userId: 7, accessLevel: 'editor' }]);

    await expect(service.prepareRun(makeRun(plan), USER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(libraryGate.current(1)).toBeNull();
    expect(libraryGate.current(2)).toBeNull();
  });

  it('fails the run when the target folder is gone', async () => {
    const plan = await service.planRun(makeDto(), USER);
    moveRepo.findTargetLibrary.mockResolvedValue(null);

    await expect(service.prepareRun(makeRun(plan), USER)).rejects.toBeInstanceOf(NotFoundException);
    expect(libraryGate.current(1)).toBeNull();
  });
});

describe('a run', () => {
  it('stops and restarts watchers for every involved library', async () => {
    await runMove();

    expect(fileWatcherService.stopWatcher.mock.calls.map((call) => call[0]).sort()).toEqual([1, 2]);
    expect(fileWatcherService.startWatcher).toHaveBeenCalledWith(1, ['/libA']);
    expect(fileWatcherService.startWatcher).toHaveBeenCalledWith(2, ['/libB']);
  });

  it('restarts watchers and frees the libraries even when closing the job throws', async () => {
    moveRepo.finishJob.mockRejectedValueOnce(new Error('db gone'));

    await expect(runMove()).rejects.toThrow('db gone');

    expect(fileWatcherService.startWatcher).toHaveBeenCalledWith(1, ['/libA']);
    expect(fileWatcherService.startWatcher).toHaveBeenCalledWith(2, ['/libB']);
    expect(service.isBusy(1)).toBe(false);
  });

  it('only stops watchers for libraries that are actually watched', async () => {
    moveRepo.findWatchedLibraryIds.mockResolvedValue([2]);

    await runMove();

    expect(fileWatcherService.stopWatcher).toHaveBeenCalledTimes(1);
    expect(fileWatcherService.stopWatcher).toHaveBeenCalledWith(2);
  });

  it('emits one transfer event per source library', async () => {
    moveRepo.findMoveBookData.mockResolvedValue([
      makeBook({
        bookId: 1,
        libraryId: 1,
        folderPath: '/libA/One',
        files: [{ id: 10, absolutePath: '/libA/One/a.epub', relPath: null, role: 'content', format: 'epub', fileHash: null, sortOrder: null }],
      }),
      makeBook({
        bookId: 2,
        libraryId: 3,
        libraryFolderId: 33,
        libraryFolderPath: '/libC',
        folderPath: '/libC/Two',
        metadata: { ...makeBook().metadata, title: 'Other' },
        files: [{ id: 20, absolutePath: '/libC/Two/b.epub', relPath: null, role: 'content', format: 'epub', fileHash: null, sortOrder: null }],
      }),
    ]);
    bookService.resolveSelectionToIds.mockResolvedValue([1, 2]);
    moveRepo.findLibraryAccess.mockResolvedValue([
      { libraryId: 1, userId: 7, accessLevel: 'editor' },
      { libraryId: 2, userId: 7, accessLevel: 'editor' },
      { libraryId: 3, userId: 7, accessLevel: 'editor' },
    ]);

    await runMove();

    expect(scanGateway.emitBookTransferred).toHaveBeenCalledTimes(2);
    expect(scanGateway.emitBookTransferred).toHaveBeenCalledWith({ fromLibraryId: 1, toLibraryId: 2, bookIds: [1] });
    expect(scanGateway.emitBookTransferred).toHaveBeenCalledWith({ fromLibraryId: 3, toLibraryId: 2, bookIds: [2] });
  });

  it('reports per-book progress and a final summary', async () => {
    const { events, summary } = await runMove();

    expect(events).toEqual([{ bookId: 1, status: 'success' }]);
    expect(summary).toEqual({ processed: 1, succeeded: 1, merged: 0, failed: 0, skipped: 0, cancelled: false });
  });

  it('records a failure without aborting the rest of the run', async () => {
    bookService.resolveSelectionToIds.mockResolvedValue([1, 2]);
    moveRepo.findMoveBookData.mockResolvedValue(twoBooks());
    executor.execute
      .mockResolvedValueOnce({ status: 'failed', reason: 'disk full' })
      .mockResolvedValueOnce({ status: 'success', crossDevice: false });

    const { events, summary } = await runMove();

    expect(events).toEqual([
      { bookId: 1, status: 'failed', reason: 'disk full' },
      { bookId: 2, status: 'success' },
    ]);
    expect(summary).toMatchObject({ succeeded: 1, failed: 1 });
  });

  it('turns an executor throw into a failed book rather than a dead run', async () => {
    executor.execute.mockRejectedValue(new Error('unexpected'));

    const plan = await service.planRun(makeDto(), USER);
    const prepared = await service.prepareRun(makeRun(plan), USER);
    if (prepared === 'busy') throw new Error('busy');
    const outcome = await service.moveOne(1, prepared.state, USER);

    expect(outcome).toEqual({
      outcome: 'failed',
      code: 'move-failed',
      message: 'unexpected',
      event: { bookId: 1, status: 'failed', reason: 'unexpected' },
    });
    await service.finishRun(makeRun(plan, { status: 'completed', processed: 1, failed: 1 }), prepared.state, 'completed');
  });

  it('counts a merge as a success with a merged stat', async () => {
    moveRepo.findFolderPathOwners.mockResolvedValue(new Map([['/libB/Dune', 55]]));
    moveRepo.findMoveBookData.mockResolvedValue([
      makeBook({
        files: [{ id: 10, absolutePath: '/libA/Dune/Dune.epub', relPath: null, role: 'content', format: 'epub', fileHash: 'abc', sortOrder: null }],
      }),
    ]);
    moveRepo.findHashOwnersInLibrary.mockResolvedValue(new Map([['abc', 55]]));
    executor.execute.mockResolvedValue({ status: 'merged', crossDevice: false, mergedBookId: 55 });

    const plan = await service.planRun(makeDto({ collisionPolicy: 'merge' }), USER);
    const prepared = await service.prepareRun(makeRun(plan), USER);
    if (prepared === 'busy') throw new Error('busy');

    await expect(service.moveOne(1, prepared.state, USER)).resolves.toEqual({
      outcome: 'succeeded',
      stats: { merged: 1 },
      event: { bookId: 1, status: 'merged' },
    });
    await service.finishRun(makeRun(plan, { status: 'completed' }), prepared.state, 'completed');
  });

  it('stops before the next book once cancelled and closes the job as completed', async () => {
    bookService.resolveSelectionToIds.mockResolvedValue([1, 2]);
    moveRepo.findMoveBookData.mockResolvedValue(twoBooks());

    const { summary } = await runMove(makeDto(), USER, { cancelWhen: () => executor.execute.mock.calls.length > 0 });

    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({ processed: 1, succeeded: 1, merged: 0, failed: 0, skipped: 0, cancelled: true });
    expect(moveRepo.finishJob).toHaveBeenCalledWith(101, 'completed', { succeeded: 1, merged: 0, failed: 0, skipped: 0 });
    expect(notificationService.notify).toHaveBeenCalledTimes(1);
    expect(service.isBusy(1)).toBe(false);
  });

  it('records the job and closes it out', async () => {
    await runMove();

    expect(moveRepo.createJob).toHaveBeenCalledWith({
      startedBy: 7,
      targetLibraryId: 2,
      targetFolderId: 22,
      sourceLibraryIds: [1],
      totalBooks: 1,
    });
    expect(moveRepo.finishJob).toHaveBeenCalledWith(101, 'completed', { succeeded: 1, merged: 0, failed: 0, skipped: 0 });
  });

  it('marks the job failed, without a completion notice, when the run fails', async () => {
    await runMove(makeDto(), USER, { end: 'failed', error: 'credential-revoked' });

    expect(moveRepo.finishJob).toHaveBeenLastCalledWith(101, 'failed', { succeeded: 1, merged: 0, failed: 0, skipped: 0 }, 'credential-revoked');
    expect(notificationService.notify).not.toHaveBeenCalled();
    expect(scanGateway.emitBookTransferred).toHaveBeenCalledWith({ fromLibraryId: 1, toLibraryId: 2, bookIds: [1] });
    expect(service.isBusy(1)).toBe(false);
  });

  it('notifies the requester with the run totals, including books moved before a restart', async () => {
    const plan = await service.planRun(makeDto(), USER);
    const prepared = await service.prepareRun(makeRun(plan), USER);
    if (prepared === 'busy') throw new Error('busy');
    await service.moveOne(1, prepared.state, USER);

    await service.finishRun(makeRun(plan, { status: 'completed', processed: 40, succeeded: 37, failed: 3 }), prepared.state, 'completed');

    expect(notificationService.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Book move completed with errors',
        message: '37 moved to Manga, 3 failed',
        scope: { kind: 'user', userId: 7 },
      }),
    );
  });

  it('does nothing at the end of a run that never started', async () => {
    const plan = await service.planRun(makeDto(), USER);

    await service.finishRun(makeRun(plan, { status: 'cancelled' }), null, 'cancelled');

    expect(moveRepo.finishJob).not.toHaveBeenCalled();
    expect(fileWatcherService.startWatcher).not.toHaveBeenCalled();
    expect(notificationService.notify).not.toHaveBeenCalled();
  });
});

describe('books that changed while the run waited', () => {
  it('skips a book deleted meanwhile instead of failing the run', async () => {
    bookService.resolveSelectionToIds.mockResolvedValue([1, 2]);
    moveRepo.findMoveBookData.mockResolvedValue(twoBooks());
    const plan = await service.planRun(makeDto(), USER);
    moveRepo.findMoveBookData.mockResolvedValue([twoBooks()[1]!]);

    const prepared = await service.prepareRun(makeRun(plan), USER);
    if (prepared === 'busy') throw new Error('busy');

    await expect(service.moveOne(1, prepared.state, USER)).resolves.toEqual({
      outcome: 'skipped',
      code: 'not-found',
      event: { bookId: 1, status: 'skipped', reason: 'book no longer exists' },
    });
    await expect(service.moveOne(2, prepared.state, USER)).resolves.toMatchObject({ outcome: 'succeeded' });
    await service.finishRun(makeRun(plan, { status: 'completed' }), prepared.state, 'completed');
    expect(moveRepo.finishJob).toHaveBeenCalledWith(101, 'completed', { succeeded: 1, merged: 0, failed: 0, skipped: 1 });
  });

  it('skips a book whose library the account can no longer edit', async () => {
    bookService.resolveSelectionToIds.mockResolvedValue([1, 2]);
    moveRepo.findMoveBookData.mockResolvedValue(twoBooks());
    const plan = await service.planRun(makeDto(), USER);
    moveRepo.findMoveBookData.mockResolvedValue([twoBooks()[0]!, { ...twoBooks()[1]!, libraryId: 3, libraryFolderId: 33 }]);

    const prepared = await service.prepareRun(makeRun(plan), USER);
    if (prepared === 'busy') throw new Error('busy');

    await expect(service.moveOne(2, prepared.state, USER)).resolves.toMatchObject({
      outcome: 'skipped',
      code: 'no-access',
      event: { bookId: 2, status: 'skipped', reason: 'no editor access to the source library' },
    });
    expect(service.isBusy(3)).toBe(false);
    await service.finishRun(makeRun(plan, { status: 'completed' }), prepared.state, 'completed');
  });

  it('reads library access again when the run refreshes its account', async () => {
    const plan = await service.planRun(makeDto(), USER);
    const prepared = await service.prepareRun(makeRun(plan), USER);
    if (prepared === 'busy') throw new Error('busy');
    moveRepo.findLibraryAccess.mockResolvedValue([{ libraryId: 2, userId: 7, accessLevel: 'editor' }]);

    await expect(service.moveOne(1, prepared.state, { ...USER })).resolves.toMatchObject({ outcome: 'skipped', code: 'no-access' });
    expect(executor.execute).not.toHaveBeenCalled();
    await service.finishRun(makeRun(plan, { status: 'completed' }), prepared.state, 'completed');
  });

  it('continues after a restart from the first book not yet done, skipping one already moved', async () => {
    bookService.resolveSelectionToIds.mockResolvedValue([1, 2]);
    moveRepo.findMoveBookData.mockResolvedValue(twoBooks());
    const plan = await service.planRun(makeDto(), USER);
    // The book in flight when the server stopped had reached the target already.
    moveRepo.findMoveBookData.mockImplementation((...args: unknown[]) =>
      Promise.resolve(
        (args[0] as number[]).map((bookId) => (bookId === 2 ? { ...twoBooks()[1]!, libraryId: 2, libraryFolderId: 22 } : twoBooks()[0]!)),
      ),
    );

    const run = makeRun(plan, { processed: 1, succeeded: 1 });
    const prepared = await service.prepareRun(run, USER);
    if (prepared === 'busy') throw new Error('busy');

    expect(moveRepo.findMoveBookData).toHaveBeenLastCalledWith([2]);
    expect(moveRepo.createJob).toHaveBeenCalledWith(expect.objectContaining({ totalBooks: 1 }));
    await expect(service.moveOne(2, prepared.state, USER)).resolves.toMatchObject({
      outcome: 'skipped',
      code: 'already-in-target',
    });
    expect(executor.execute).not.toHaveBeenCalled();
    await service.finishRun(run, prepared.state, 'completed');
  });

  it('skips a book that now collides under the skip policy', async () => {
    const plan = await service.planRun(makeDto({ collisionPolicy: 'skip' }), USER);
    expect(plan.subjectIds).toEqual([1]);
    moveRepo.findFolderPathOwners.mockResolvedValue(new Map([['/libB/Dune', 99]]));

    const prepared = await service.prepareRun(makeRun(plan), USER);
    if (prepared === 'busy') throw new Error('busy');

    await expect(service.moveOne(1, prepared.state, USER)).resolves.toMatchObject({ outcome: 'skipped', code: 'collision-skipped' });
    await service.finishRun(makeRun(plan, { status: 'completed' }), prepared.state, 'completed');
  });
});

describe('continuing after a restart', () => {
  function interruptedRun(options: Record<string, unknown> = { targetLibraryId: 2, sourceLibraryIds: [1] }): Pick<BulkRunRow, 'options'> {
    return { options };
  }

  it('waits for the boot check before offering Continue', () => {
    expect(service.isContinuable(interruptedRun())).toBe(false);
  });

  it('allows Continue once the boot check found nothing to rescan', async () => {
    await service.onApplicationBootstrap();

    expect(service.isContinuable(interruptedRun())).toBe(true);
  });

  it('waits while a library of the run is still being rescanned, then allows it', async () => {
    moveRepo.markInterruptedJobs.mockResolvedValue([{ id: 5, libraryIds: [1, 2] }]);
    const releaseScan = libraryGate.tryAcquire(1, 'scan');
    await service.onApplicationBootstrap();

    expect(service.isContinuable(interruptedRun())).toBe(false);
    expect(service.isContinuable(interruptedRun({ targetLibraryId: 3, sourceLibraryIds: [4] }))).toBe(true);

    releaseScan?.();
    expect(service.isContinuable(interruptedRun())).toBe(true);
    // Once the boot scan ended, a later operation on the library no longer holds Continue back.
    const releaseLater = libraryGate.tryAcquire(1, 'scan');
    expect(service.isContinuable(interruptedRun())).toBe(true);
    releaseLater?.();
  });

  it('checks every boot rescan for a run that kept no libraries', async () => {
    moveRepo.markInterruptedJobs.mockResolvedValue([{ id: 5, libraryIds: [1] }]);
    scannerService.isScanRunning.mockReturnValue(true);
    await service.onApplicationBootstrap();

    expect(service.isContinuable(interruptedRun({}))).toBe(false);
    scannerService.isScanRunning.mockReturnValue(false);
    expect(service.isContinuable(interruptedRun({}))).toBe(true);
  });
});

describe('the final event', () => {
  it('rebuilds the route summary from the run, leaving merges out of succeeded', () => {
    expect(bookMoveDoneEvent({ status: 'cancelled', processed: 9, succeeded: 5, failed: 1, skipped: 3, stats: { merged: 2 } })).toEqual({
      done: true,
      processed: 9,
      succeeded: 3,
      merged: 2,
      failed: 1,
      skipped: 3,
      cancelled: true,
    });
    expect(bookMoveDoneEvent({ status: 'completed', processed: 0, succeeded: 0, failed: 0, skipped: 0, stats: {} })).toEqual({
      done: true,
      processed: 0,
      succeeded: 0,
      merged: 0,
      failed: 0,
      skipped: 0,
      cancelled: false,
    });
  });
});

describe('destination lookup', () => {
  it('checks suffixed names against the database before offering them', async () => {
    // "Dune (2)" is only invented while resolving the first collision, so a single
    // lookup pass would hand out a name another book already owns.
    const taken = new Map([
      ['/libB/Dune', 99],
      ['/libB/Dune (2)', 98],
    ]);
    moveRepo.findFolderPathOwners.mockImplementation((...args: unknown[]) => {
      const paths = args[1] as string[];
      return Promise.resolve(new Map(paths.filter((path) => taken.has(path)).map((path) => [path, taken.get(path)!])));
    });

    const result = await service.preview(makeDto(), USER);

    expect(result.collisions[0].keepBothPath).toBe('/libB/Dune (3)/Dune.epub');
  });

  it('stops querying once no new destination is proposed', async () => {
    await service.preview(makeDto(), USER);

    // One round to check the base paths, one to confirm nothing new appeared.
    expect(moveRepo.findFolderPathOwners.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe('collision policies', () => {
  beforeEach(() => {
    moveRepo.findFolderPathOwners.mockResolvedValue(new Map([['/libB/Dune', 99]]));
  });

  it('merges an identical copy but keeps both for a name-only clash under suggested', async () => {
    bookService.resolveSelectionToIds.mockResolvedValue([1, 2]);
    moveRepo.findMoveBookData.mockResolvedValue([
      makeBook({
        bookId: 1,
        folderPath: '/libA/Dune',
        files: [{ id: 10, absolutePath: '/libA/Dune/Dune.epub', relPath: null, role: 'content', format: 'epub', fileHash: 'abc', sortOrder: null }],
      }),
      makeBook({
        bookId: 2,
        folderPath: '/libA/Other',
        metadata: { ...makeBook().metadata, title: 'Other' },
        files: [{ id: 20, absolutePath: '/libA/Other/Other.epub', relPath: null, role: 'content', format: 'epub', fileHash: null, sortOrder: null }],
      }),
    ]);
    // Book 1 is byte-identical to something already there; book 2 only clashes on name.
    moveRepo.findHashOwnersInLibrary.mockResolvedValue(new Map([['abc', 55]]));
    moveRepo.findFolderPathOwners.mockResolvedValue(
      new Map([
        ['/libB/Dune', 55],
        ['/libB/Other', 66],
      ]),
    );

    await runMove(makeDto({ collisionPolicy: 'suggested' }));

    const byBook = new Map(executor.execute.mock.calls.map((call) => [call[0].plan.bookId, call[0]]));
    expect(byBook.get(1)?.mergeDuplicateBookId).toBe(55);
    expect(byBook.get(1)?.plan.targetFolderPathKey).toBe('/libB/Dune');
    expect(byBook.get(2)?.mergeDuplicateBookId).toBeNull();
    expect(byBook.get(2)?.plan.targetFolderPathKey).toBe('/libB/Other (2)');
  });

  it('lets an explicit job policy override the per-collision suggestion', async () => {
    moveRepo.findMoveBookData.mockResolvedValue([
      makeBook({
        files: [{ id: 10, absolutePath: '/libA/Dune/Dune.epub', relPath: null, role: 'content', format: 'epub', fileHash: 'abc', sortOrder: null }],
      }),
    ]);
    moveRepo.findHashOwnersInLibrary.mockResolvedValue(new Map([['abc', 55]]));

    await runMove(makeDto({ collisionPolicy: 'keep_both' }));

    // Suggested would have merged this one; the user asked for keep_both instead.
    expect(executor.execute.mock.calls[0][0].mergeDuplicateBookId).toBeNull();
  });

  it('lets a per-book override beat the suggestion', async () => {
    moveRepo.findMoveBookData.mockResolvedValue([
      makeBook({
        files: [{ id: 10, absolutePath: '/libA/Dune/Dune.epub', relPath: null, role: 'content', format: 'epub', fileHash: 'abc', sortOrder: null }],
      }),
    ]);
    moveRepo.findHashOwnersInLibrary.mockResolvedValue(new Map([['abc', 55]]));

    const { summary } = await runMove(makeDto({ collisionPolicy: 'suggested', overrides: [{ bookId: 1, policy: 'skip' }] }));

    expect(executor.execute).not.toHaveBeenCalled();
    expect(summary.processed).toBe(0);
  });

  it('moves to a suffixed destination under keep_both', async () => {
    await runMove(makeDto({ collisionPolicy: 'keep_both' }));

    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(executor.execute.mock.calls[0][0].plan.targetFolderPathKey).toBe('/libB/Dune (2)');
  });

  it('leaves colliding books untouched under skip', async () => {
    const { summary } = await runMove(makeDto({ collisionPolicy: 'skip' }));

    expect(executor.execute).not.toHaveBeenCalled();
    expect(summary.processed).toBe(0);
  });

  it('merges into the duplicate when content is identical', async () => {
    moveRepo.findMoveBookData.mockResolvedValue([
      makeBook({
        files: [{ id: 10, absolutePath: '/libA/Dune/Dune.epub', relPath: null, role: 'content', format: 'epub', fileHash: 'abc', sortOrder: null }],
      }),
    ]);
    moveRepo.findHashOwnersInLibrary.mockResolvedValue(new Map([['abc', 55]]));
    executor.execute.mockResolvedValue({ status: 'merged', crossDevice: false, mergedBookId: 55 });

    const { summary, run } = await runMove(makeDto({ collisionPolicy: 'merge' }));

    expect(executor.execute.mock.calls[0][0].mergeDuplicateBookId).toBe(55);
    expect(run.stats).toEqual({ merged: 1 });
    expect(summary).toMatchObject({ merged: 1, succeeded: 0 });
  });

  it('refuses to merge a name-only collision instead of deleting an unrelated book', async () => {
    const { events, summary } = await runMove(makeDto({ collisionPolicy: 'merge' }));

    expect(executor.execute).not.toHaveBeenCalled();
    expect(events).toEqual([{ bookId: 1, status: 'skipped', reason: 'merge only applies to identical copies' }]);
    expect(summary.skipped).toBe(1);
  });

  it('lets a per-book override beat the job policy', async () => {
    await runMove(makeDto({ collisionPolicy: 'skip', overrides: [{ bookId: 1, policy: 'keep_both' }] }));

    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(executor.execute.mock.calls[0][0].plan.targetFolderPathKey).toBe('/libB/Dune (2)');
  });

  it('never moves an ineligible book even when a policy is set', async () => {
    moveRepo.findMoveBookData.mockResolvedValue([makeBook({ status: 'missing' })]);

    const { summary } = await runMove();

    expect(executor.execute).not.toHaveBeenCalled();
    expect(summary.processed).toBe(0);
  });
});

describe('crash recovery', () => {
  it('rescans libraries touched by a job that never finished', async () => {
    moveRepo.markInterruptedJobs.mockResolvedValue([{ id: 5, libraryIds: [1, 2] }]);

    await service.onApplicationBootstrap();

    expect(scannerService.startScanAsync).toHaveBeenCalledWith(1);
    expect(scannerService.startScanAsync).toHaveBeenCalledWith(2);
  });

  it('does nothing when no job was interrupted', async () => {
    await service.onApplicationBootstrap();

    expect(scannerService.startScanAsync).not.toHaveBeenCalled();
  });

  it('survives a database error during recovery', async () => {
    moveRepo.markInterruptedJobs.mockRejectedValue(new Error('db down'));

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(scannerService.startScanAsync).not.toHaveBeenCalled();
  });
});
