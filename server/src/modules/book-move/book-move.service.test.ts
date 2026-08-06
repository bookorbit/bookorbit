import type { Mock } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { BookMovePlannerService } from './book-move-planner.service';
import { BookMoveService } from './book-move.service';
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
  );
}

function collectProgress() {
  const events: unknown[] = [];
  return {
    events,
    options: { onProgress: (event: unknown) => events.push(event), isCancelled: () => false },
  };
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

describe('execute guards', () => {
  it('refuses when a scan is running on any involved library', async () => {
    scannerService.isScanRunning.mockImplementation((libraryId: number) => libraryId === 1);

    await expect(service.execute(makeDto(), USER, collectProgress().options)).rejects.toBeInstanceOf(ConflictException);
    expect(fileWatcherService.stopWatcher).not.toHaveBeenCalled();
  });

  it('refuses a second concurrent move touching the same library', async () => {
    let releaseFirst: () => void = () => {};
    executor.execute.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseFirst = () => resolve({ status: 'success', crossDevice: false });
        }),
    );

    const first = service.execute(makeDto(), USER, collectProgress().options);
    await vi.waitFor(() => expect(executor.execute).toHaveBeenCalled());

    await expect(service.execute(makeDto(), USER, collectProgress().options)).rejects.toBeInstanceOf(ConflictException);

    releaseFirst();
    await first;

    // The guard is released once the job finishes.
    expect(service.isBusy(1)).toBe(false);
    expect(service.isBusy(2)).toBe(false);
  });
});

describe('execute', () => {
  it('stops and restarts watchers for every involved library', async () => {
    await service.execute(makeDto(), USER, collectProgress().options);

    expect(fileWatcherService.stopWatcher.mock.calls.map((call) => call[0]).sort()).toEqual([1, 2]);
    expect(fileWatcherService.startWatcher).toHaveBeenCalledWith(1, ['/libA']);
    expect(fileWatcherService.startWatcher).toHaveBeenCalledWith(2, ['/libB']);
  });

  it('restarts watchers even when the job throws', async () => {
    moveRepo.finishJob.mockRejectedValueOnce(new Error('db gone'));

    await expect(service.execute(makeDto(), USER, collectProgress().options)).rejects.toThrow('db gone');

    expect(fileWatcherService.startWatcher).toHaveBeenCalledWith(1, ['/libA']);
    expect(fileWatcherService.startWatcher).toHaveBeenCalledWith(2, ['/libB']);
  });

  it('only stops watchers for libraries that are actually watched', async () => {
    moveRepo.findWatchedLibraryIds.mockResolvedValue([2]);

    await service.execute(makeDto(), USER, collectProgress().options);

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

    await service.execute(makeDto(), USER, collectProgress().options);

    expect(scanGateway.emitBookTransferred).toHaveBeenCalledTimes(2);
    expect(scanGateway.emitBookTransferred).toHaveBeenCalledWith({ fromLibraryId: 1, toLibraryId: 2, bookIds: [1] });
    expect(scanGateway.emitBookTransferred).toHaveBeenCalledWith({ fromLibraryId: 3, toLibraryId: 2, bookIds: [2] });
  });

  it('reports per-book progress and a final summary', async () => {
    const progress = collectProgress();

    const summary = await service.execute(makeDto(), USER, progress.options);

    expect(progress.events).toEqual([{ bookId: 1, status: 'success' }]);
    expect(summary).toMatchObject({ processed: 1, succeeded: 1, merged: 0, failed: 0, skipped: 0, cancelled: false });
  });

  it('records a failure without aborting the rest of the job', async () => {
    bookService.resolveSelectionToIds.mockResolvedValue([1, 2]);
    moveRepo.findMoveBookData.mockResolvedValue([
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
    ]);
    executor.execute
      .mockResolvedValueOnce({ status: 'failed', reason: 'disk full' })
      .mockResolvedValueOnce({ status: 'success', crossDevice: false });

    const progress = collectProgress();
    const summary = await service.execute(makeDto(), USER, progress.options);

    expect(progress.events).toEqual([
      { bookId: 1, status: 'failed', reason: 'disk full' },
      { bookId: 2, status: 'success' },
    ]);
    expect(summary).toMatchObject({ succeeded: 1, failed: 1 });
  });

  it('turns an executor throw into a failed book rather than a dead job', async () => {
    executor.execute.mockRejectedValue(new Error('unexpected'));

    const progress = collectProgress();
    const summary = await service.execute(makeDto(), USER, progress.options);

    expect(progress.events).toEqual([{ bookId: 1, status: 'failed', reason: 'unexpected' }]);
    expect(summary.failed).toBe(1);
  });

  it('stops early when the client disconnects', async () => {
    bookService.resolveSelectionToIds.mockResolvedValue([1, 2]);
    moveRepo.findMoveBookData.mockResolvedValue([
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
    ]);

    let cancelled = false;
    const events: unknown[] = [];
    executor.execute.mockImplementation(() => {
      cancelled = true;
      return Promise.resolve({ status: 'success', crossDevice: false });
    });

    const summary = await service.execute(makeDto(), USER, {
      onProgress: (event) => events.push(event),
      isCancelled: () => cancelled,
    });

    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ succeeded: 1, cancelled: true });
  });

  it('records the job and closes it out', async () => {
    await service.execute(makeDto(), USER, collectProgress().options);

    expect(moveRepo.createJob).toHaveBeenCalledWith({
      startedBy: 7,
      targetLibraryId: 2,
      targetFolderId: 22,
      sourceLibraryIds: [1],
      totalBooks: 1,
    });
    expect(moveRepo.finishJob).toHaveBeenCalledWith(101, 'completed', { succeeded: 1, merged: 0, failed: 0, skipped: 0 });
  });

  it('marks the job failed when the run throws', async () => {
    moveRepo.finishJob.mockRejectedValueOnce(new Error('db gone'));

    await expect(service.execute(makeDto(), USER, collectProgress().options)).rejects.toThrow('db gone');

    expect(moveRepo.finishJob).toHaveBeenLastCalledWith(101, 'failed', { succeeded: 1, merged: 0, failed: 0, skipped: 0 }, 'db gone');
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

    await service.execute(makeDto({ collisionPolicy: 'suggested' }), USER, collectProgress().options);

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

    await service.execute(makeDto({ collisionPolicy: 'keep_both' }), USER, collectProgress().options);

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

    const summary = await service.execute(
      makeDto({ collisionPolicy: 'suggested', overrides: [{ bookId: 1, policy: 'skip' }] }),
      USER,
      collectProgress().options,
    );

    expect(executor.execute).not.toHaveBeenCalled();
    expect(summary.processed).toBe(0);
  });

  it('moves to a suffixed destination under keep_both', async () => {
    await service.execute(makeDto({ collisionPolicy: 'keep_both' }), USER, collectProgress().options);

    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(executor.execute.mock.calls[0][0].plan.targetFolderPathKey).toBe('/libB/Dune (2)');
  });

  it('leaves colliding books untouched under skip', async () => {
    const summary = await service.execute(makeDto({ collisionPolicy: 'skip' }), USER, collectProgress().options);

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

    const summary = await service.execute(makeDto({ collisionPolicy: 'merge' }), USER, collectProgress().options);

    expect(executor.execute.mock.calls[0][0].mergeDuplicateBookId).toBe(55);
    expect(summary).toMatchObject({ merged: 1, succeeded: 0 });
  });

  it('refuses to merge a name-only collision instead of deleting an unrelated book', async () => {
    const progress = collectProgress();

    const summary = await service.execute(makeDto({ collisionPolicy: 'merge' }), USER, progress.options);

    expect(executor.execute).not.toHaveBeenCalled();
    expect(progress.events).toEqual([{ bookId: 1, status: 'skipped', reason: 'merge only applies to identical copies' }]);
    expect(summary.skipped).toBe(1);
  });

  it('lets a per-book override beat the job policy', async () => {
    await service.execute(makeDto({ collisionPolicy: 'skip', overrides: [{ bookId: 1, policy: 'keep_both' }] }), USER, collectProgress().options);

    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(executor.execute.mock.calls[0][0].plan.targetFolderPathKey).toBe('/libB/Dune (2)');
  });

  it('never moves an ineligible book even when a policy is set', async () => {
    moveRepo.findMoveBookData.mockResolvedValue([makeBook({ status: 'missing' })]);

    const summary = await service.execute(makeDto(), USER, collectProgress().options);

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
