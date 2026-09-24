vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  realpath: vi.fn(),
  rm: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('../scanner/lib/classify', () => ({
  isPrimaryFormat: vi.fn(),
}));

vi.mock('@bookorbit/types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bookorbit/types')>();
  return {
    ...actual,
    APP_FEATURES: Object.freeze({ ...actual.APP_FEATURES, podcasts: true }),
  };
});

import { BadRequestException, ConflictException, ForbiddenException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';
import { readdir, realpath, rm, stat } from 'fs/promises';

import { ACHIEVEMENT_EVENT_LIBRARY_CATALOG_CHANGED } from '../achievement/achievement-events.service';
import { isPrimaryFormat } from '../scanner/lib/classify';
import { LibraryService } from './library.service';

const mockReaddir = readdir as MockedFunction<typeof readdir>;
const mockRealpath = realpath as MockedFunction<typeof realpath>;
const mockRm = rm as MockedFunction<typeof rm>;
const mockStat = stat as MockedFunction<typeof stat>;
const mockIsPrimaryFormat = isPrimaryFormat as MockedFunction<typeof isPrimaryFormat>;

function dirent(name: string, kind: 'file' | 'dir') {
  return {
    name,
    isDirectory: () => kind === 'dir',
    isFile: () => kind === 'file',
  };
}

describe('LibraryService', () => {
  const libraryRepo = {
    hasUserAccess: vi.fn(),
    findUserAccessLevel: vi.fn(),
    findAll: vi.fn(),
    findAllForUser: vi.fn(),
    findAllIds: vi.fn(),
    findAccessibleIdsForUser: vi.fn(),
    findAllFolders: vi.fn(),
    findFoldersByLibraryIds: vi.fn(),
    findById: vi.fn(),
    findByIds: vi.fn(),
    findFoldersByLibrary: vi.fn(),
    findByName: vi.fn(),
    insert: vi.fn(),
    insertFolders: vi.fn(),
    insertPodcastSettings: vi.fn(),
    findPodcastMediaFiles: vi.fn(),
    findPodcastCleanupJobs: vi.fn(),
    findPodcastIds: vi.fn(),
    hasPodcastMediaFiles: vi.fn(),
    hasBlockingPodcastStorageJobs: vi.fn(),
    cancelPodcastJobs: vi.fn(),
    update: vi.fn(),
    deleteFolder: vi.fn(),
    findBookIdsByLibrary: vi.fn(),
    delete: vi.fn(),
    findAllFolderPaths: vi.fn(),
    getStats: vi.fn(),
    getStatsForLibraries: vi.fn(),
    updateDisplayOrders: vi.fn(),
    getAccessWithUsers: vi.fn(),
    grantAccess: vi.fn(),
    updateAccess: vi.fn(),
    revokeAccess: vi.fn(),
  };

  const config = { get: vi.fn().mockReturnValue('/books') };
  const scannerService = { startScanAsync: vi.fn(), getLatestScans: vi.fn() };
  const fileWatcherService = { startWatcher: vi.fn(), stopWatcher: vi.fn() };
  const fileWriteService = {
    findNonMissingPrimaryFilesByLibrary: vi.fn(),
    writeToFile: vi.fn(),
  };
  const achievementEvents = {
    emit: vi.fn(),
  };
  const pathPolicy = {
    assertWithinBrowseRoot: vi.fn((path: string) => Promise.resolve(path)),
    resolveBrowsePath: vi.fn((path: string) => Promise.resolve(path)),
  };
  const scanScheduler = {
    syncSchedule: vi.fn(),
    removeSchedule: vi.fn(),
  };

  let service: LibraryService;

  beforeEach(() => {
    vi.resetAllMocks();
    config.get.mockReturnValue('/books');
    service = new LibraryService(
      libraryRepo as any,
      config as any,
      scannerService as any,
      fileWatcherService as any,
      fileWriteService as any,
      achievementEvents as any,
      pathPolicy as any,
      scanScheduler as any,
    );

    libraryRepo.findPodcastIds.mockResolvedValue([]);
    libraryRepo.findById.mockResolvedValue([{ id: 1, type: 'books' }]);
    libraryRepo.findByIds.mockImplementation((ids: number[]) => Promise.resolve(ids.map((id) => ({ id }))));
    mockStat.mockResolvedValue({ isDirectory: () => true } as Awaited<ReturnType<typeof stat>>);
    mockRealpath.mockImplementation((path) => Promise.resolve(path.toString()));
    mockReaddir.mockResolvedValue([] as unknown as Awaited<ReturnType<typeof readdir>>);
    mockRm.mockResolvedValue(undefined);
    mockIsPrimaryFormat.mockReturnValue(false);
    libraryRepo.cancelPodcastJobs.mockResolvedValue(0);
    libraryRepo.hasPodcastMediaFiles.mockResolvedValue(false);
    libraryRepo.hasBlockingPodcastStorageJobs.mockResolvedValue(false);
    libraryRepo.findPodcastCleanupJobs.mockResolvedValue([]);
    pathPolicy.assertWithinBrowseRoot.mockImplementation((path: string) => Promise.resolve(path));
    pathPolicy.resolveBrowsePath.mockImplementation((path: string) => Promise.resolve(path));
  });

  it('findAll uses scoped folder query for non-superusers', async () => {
    libraryRepo.findAllForUser.mockResolvedValue([{ id: 10, name: 'A', coverAspectRatio: '1/1', fileRenameEnabled: true }]);
    libraryRepo.findFoldersByLibraryIds.mockResolvedValue([{ id: 1, libraryId: 10, path: '/a', createdAt: new Date() }]);

    const result = await service.findAll({ id: 7, isSuperuser: false, contentFilters: EMPTY_CONTENT_FILTER_RULES } as any);

    expect(libraryRepo.findAllForUser).toHaveBeenCalledWith(7, EMPTY_CONTENT_FILTER_RULES);
    expect(libraryRepo.findFoldersByLibraryIds).toHaveBeenCalledWith([10]);
    expect(libraryRepo.findAllFolders).not.toHaveBeenCalled();
    expect(result[0].folders).toEqual([{ id: 1, path: '/a', createdAt: expect.any(Date) }]);
    expect(result[0].coverAspectRatio).toBe('1/1');
    expect(result[0].fileRenameEnabled).toBe(true);
  });

  it('passes contentFilters to findAllForUser for non-superuser and skips for superuser', async () => {
    libraryRepo.findAllForUser.mockResolvedValue([]);
    libraryRepo.findFoldersByLibraryIds.mockResolvedValue([]);
    libraryRepo.findAll.mockResolvedValue([]);
    libraryRepo.findAllFolders.mockResolvedValue([]);

    await service.findAll({ id: 7, isSuperuser: false, contentFilters: EMPTY_CONTENT_FILTER_RULES } as any);
    await service.findAll({ id: 1, isSuperuser: true, contentFilters: EMPTY_CONTENT_FILTER_RULES } as any);

    expect(libraryRepo.findAllForUser).toHaveBeenCalledWith(7, EMPTY_CONTENT_FILTER_RULES);
    expect(libraryRepo.findAll).toHaveBeenCalled();
  });

  it('findAccessibleLibraryIds reads all IDs for superusers and scoped IDs for normal users', async () => {
    libraryRepo.findAllIds.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    libraryRepo.findAccessibleIdsForUser.mockResolvedValue([{ id: 3 }, { id: 4 }]);

    await expect(service.findAccessibleLibraryIds({ id: 99, isSuperuser: true, contentFilters: EMPTY_CONTENT_FILTER_RULES } as any)).resolves.toEqual(
      [1, 2],
    );
    await expect(
      service.findAccessibleLibraryIds({ id: 42, isSuperuser: false, contentFilters: EMPTY_CONTENT_FILTER_RULES } as any),
    ).resolves.toEqual([3, 4]);
  });

  it('findOne returns library details and normalizes organization mode', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 10, name: 'Main', organizationMode: null }]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 50, path: '/books/main' }]);

    await expect(service.findOne(10)).resolves.toEqual({
      id: 10,
      name: 'Main',
      organizationMode: 'book_per_folder',
      folders: [{ id: 50, path: '/books/main' }],
    });
  });

  it('findOne throws when library is missing', async () => {
    libraryRepo.findById.mockResolvedValue([]);
    await expect(service.findOne(111)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('verifyUserAccess bypasses lookup for superusers', async () => {
    await service.verifyUserAccess(1, 2, true);
    expect(libraryRepo.hasUserAccess).not.toHaveBeenCalled();
  });

  it('verifyUserAccess throws when user has no library access', async () => {
    libraryRepo.hasUserAccess.mockResolvedValue(false);
    await expect(service.verifyUserAccess(1, 2, false)).rejects.toThrow('No access to this library');
  });

  it('verifyUserAccessLevel enforces the required library role', async () => {
    libraryRepo.findUserAccessLevel.mockResolvedValue('viewer');

    await expect(service.verifyUserAccessLevel(1, 2, false, 'editor')).rejects.toThrow('Insufficient library access level');
    await expect(service.verifyUserAccessLevel(1, 2, true, 'owner')).resolves.toBeUndefined();
  });

  it('create applies defaults, inserts folders, and starts an async scan', async () => {
    libraryRepo.findByName.mockResolvedValue([]);
    libraryRepo.insert.mockResolvedValue([{ id: 5, type: 'books', name: 'Sci-Fi', icon: 'BookOpen' }]);
    libraryRepo.insertFolders.mockResolvedValue([
      { id: 11, path: '/a' },
      { id: 12, path: '/b' },
    ]);

    const result = await service.create({ name: 'Sci-Fi', icon: 'BookOpen', folders: ['/a', '/b'] } as any);

    expect(libraryRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Sci-Fi',
        icon: 'BookOpen',
        displayOrder: 0,
        watch: false,
        metadataPrecedence: ['folderStructure', 'embedded', 'nfoFile', 'opfFile', 'sidecar'],
        formatPriority: ['epub', 'kepub', 'pdf', 'cbz', 'cbr', 'cb7', 'mobi', 'azw3', 'azw', 'fb2', 'm4b', 'mp3', 'm4a', 'opus', 'ogg', 'flac'],
        organizationMode: 'book_per_folder',
        coverAspectRatio: '2/3',
      }),
    );
    expect(scannerService.startScanAsync).toHaveBeenCalledWith(5);
    expect(fileWatcherService.startWatcher).not.toHaveBeenCalled();
    expect(libraryRepo.insertFolders).toHaveBeenCalledWith([
      { libraryId: 5, path: '/a', role: 'downloads' },
      { libraryId: 5, path: '/b', role: 'downloads' },
    ]);
    expect(result.folders).toEqual([
      { id: 11, path: '/a' },
      { id: 12, path: '/b' },
    ]);
  });

  it('create passes file write defaults to insert', async () => {
    libraryRepo.findByName.mockResolvedValue([]);
    libraryRepo.insert.mockResolvedValue([{ id: 5, type: 'books', name: 'Sci-Fi', icon: 'BookOpen' }]);
    libraryRepo.insertFolders.mockResolvedValue([{ id: 11, path: '/a' }]);

    await service.create({ name: 'Sci-Fi', icon: 'BookOpen', folders: ['/a'] } as any);

    expect(libraryRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        fileWriteEnabled: false,
        fileWriteWriteCover: true,
        fileWriteEpubEnabled: true,
        fileWriteEpubMaxFileSizeMb: 100,
        fileWritePdfEnabled: true,
        fileWritePdfMaxFileSizeMb: 100,
        fileWriteCbxEnabled: false,
        fileWriteCbxMaxFileSizeMb: 500,
        fileWriteAudioEnabled: true,
        fileWriteAudioMaxFileSizeMb: 500,
        fileRenameEnabled: false,
      }),
    );
  });

  it('create starts watcher immediately when watch is enabled', async () => {
    libraryRepo.findByName.mockResolvedValue([]);
    libraryRepo.insert.mockResolvedValue([{ id: 6, type: 'books', name: 'Watched', icon: 'BookOpen', watch: true }]);
    libraryRepo.insertFolders.mockResolvedValue([
      { id: 21, path: '/watch-a' },
      { id: 22, path: '/watch-b' },
    ]);

    await service.create({ name: 'Watched', icon: 'BookOpen', folders: ['/watch-a', '/watch-b'], watch: true } as any);

    expect(fileWatcherService.startWatcher).toHaveBeenCalledWith(6, ['/watch-a', '/watch-b']);
    expect(scannerService.startScanAsync).toHaveBeenCalledWith(6);
  });

  it('create registers the configured scan schedule', async () => {
    libraryRepo.findByName.mockResolvedValue([]);
    libraryRepo.insert.mockResolvedValue([{ id: 6, name: 'Scheduled', icon: 'BookOpen', watch: false }]);
    libraryRepo.insertFolders.mockResolvedValue([{ id: 21, path: '/scheduled' }]);

    await service.create({
      name: 'Scheduled',
      icon: 'BookOpen',
      folders: ['/scheduled'],
      autoScanCronExpression: '0 4 * * *',
    } as any);

    expect(scanScheduler.syncSchedule).toHaveBeenCalledWith(6, '0 4 * * *');
  });

  it('create enables local-folder watching for podcasts without starting book scanning', async () => {
    libraryRepo.findByName.mockResolvedValue([]);
    libraryRepo.insert.mockResolvedValue([{ id: 7, type: 'podcasts', name: 'Podcasts', icon: 'Podcast', watch: false, watchLocalFolders: true }]);
    libraryRepo.insertFolders.mockResolvedValue([{ id: 23, path: '/podcasts', role: 'downloads' }]);

    await service.create({ type: 'podcasts', name: 'Podcasts', icon: 'Podcast', folders: ['/podcasts'] } as any);

    expect(libraryRepo.insertPodcastSettings).toHaveBeenCalledWith(7);
    expect(libraryRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ watch: false, watchLocalFolders: true, coverAspectRatio: '1/1', fileWriteEnabled: false }),
    );
    expect(scannerService.startScanAsync).not.toHaveBeenCalled();
    expect(fileWatcherService.startWatcher).not.toHaveBeenCalled();
  });

  it('create rejects book-only settings for podcast libraries', async () => {
    await expect(
      service.create({ type: 'podcasts', name: 'Podcasts', icon: 'Podcast', folders: ['/podcasts'], autoScanCronExpression: '0 * * * *' } as any),
    ).rejects.toThrow('autoScanCronExpression is only supported for book libraries');

    expect(libraryRepo.insert).not.toHaveBeenCalled();
  });

  it('create rejects podcast-only watcher settings for book libraries', async () => {
    await expect(service.create({ name: 'Books', icon: 'BookOpen', folders: ['/books'], watchLocalFolders: true } as any)).rejects.toThrow(
      'watchLocalFolders is only supported for podcast libraries',
    );

    expect(libraryRepo.insert).not.toHaveBeenCalled();
  });

  it('create rejects podcast libraries with more than one storage folder', async () => {
    libraryRepo.findByName.mockResolvedValue([]);

    await expect(
      service.create({ type: 'podcasts', name: 'Podcasts', icon: 'Podcast', folders: ['/podcasts-a', '/podcasts-b'] } as any),
    ).rejects.toThrow('Podcast libraries require exactly one storage folder');

    expect(libraryRepo.insert).not.toHaveBeenCalled();
  });

  it('create stores podcast local folders alongside the downloads root', async () => {
    libraryRepo.findByName.mockResolvedValue([]);
    libraryRepo.insert.mockResolvedValue([{ id: 7, type: 'podcasts', name: 'Podcasts', icon: 'Podcast', watch: false }]);
    libraryRepo.insertFolders.mockResolvedValue([
      { id: 23, path: '/podcasts', role: 'downloads' },
      { id: 24, path: '/archive', role: 'local' },
    ]);

    await service.create({ type: 'podcasts', name: 'Podcasts', icon: 'Podcast', folders: ['/podcasts'], localFolders: ['/archive'] } as any);

    expect(libraryRepo.insertFolders).toHaveBeenCalledWith([
      { libraryId: 7, path: '/podcasts', role: 'downloads' },
      { libraryId: 7, path: '/archive', role: 'local' },
    ]);
  });

  it('create allows podcast local-folder watching to be disabled', async () => {
    libraryRepo.findByName.mockResolvedValue([]);
    libraryRepo.insert.mockResolvedValue([{ id: 7, type: 'podcasts', name: 'Podcasts', icon: 'Podcast', watchLocalFolders: false }]);
    libraryRepo.insertFolders.mockResolvedValue([{ id: 23, path: '/podcasts', role: 'downloads' }]);

    await service.create({
      type: 'podcasts',
      name: 'Podcasts',
      icon: 'Podcast',
      folders: ['/podcasts'],
      watchLocalFolders: false,
    } as any);

    expect(libraryRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ watchLocalFolders: false }));
  });

  it('create rejects duplicate library names', async () => {
    libraryRepo.findByName.mockResolvedValue([{ id: 9 }]);

    await expect(service.create({ name: 'Dup', icon: 'BookOpen', folders: ['/x'] } as any)).rejects.toBeInstanceOf(ConflictException);
  });

  it('create rejects folders outside the configured browse root before inserting the library', async () => {
    libraryRepo.findByName.mockResolvedValue([]);
    pathPolicy.assertWithinBrowseRoot.mockRejectedValue(new ForbiddenException('outside root'));

    await expect(service.create({ name: 'Sci-Fi', icon: 'BookOpen', folders: ['/outside'] } as any)).rejects.toBeInstanceOf(ForbiddenException);

    expect(libraryRepo.insert).not.toHaveBeenCalled();
    expect(libraryRepo.insertFolders).not.toHaveBeenCalled();
  });

  it('create rejects missing icons', async () => {
    libraryRepo.findByName.mockResolvedValue([]);

    await expect(service.create({ name: 'Sci-Fi', folders: ['/a'] } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(libraryRepo.insert).not.toHaveBeenCalled();
  });

  it('update synchronizes folder additions and removals', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 3, name: 'Current', icon: 'BookOpen', watch: false }]);
    libraryRepo.update.mockResolvedValue([{ id: 3, name: 'Updated' }]);
    libraryRepo.findFoldersByLibrary
      .mockResolvedValueOnce([
        { id: 1, path: '/keep', role: 'downloads' },
        { id: 2, path: '/remove', role: 'downloads' },
      ])
      .mockResolvedValueOnce([
        { id: 1, path: '/keep', role: 'downloads' },
        { id: 3, path: '/add', role: 'downloads' },
      ]);

    await service.update(3, { folders: ['/keep', '/add'] } as any);

    expect(libraryRepo.deleteFolder).toHaveBeenCalledWith(2);
    expect(libraryRepo.insertFolders).toHaveBeenCalledWith([{ libraryId: 3, path: '/add', role: 'downloads' }]);
    expect(fileWatcherService.startWatcher).not.toHaveBeenCalled();
    expect(fileWatcherService.stopWatcher).not.toHaveBeenCalled();
  });

  it('update rejects folders outside the configured browse root before changing the library', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 3, name: 'Current', icon: 'BookOpen', watch: false }]);
    pathPolicy.assertWithinBrowseRoot.mockRejectedValue(new ForbiddenException('outside root'));

    await expect(service.update(3, { folders: ['/outside'] } as any)).rejects.toBeInstanceOf(ForbiddenException);

    expect(libraryRepo.update).not.toHaveBeenCalled();
    expect(libraryRepo.insertFolders).not.toHaveBeenCalled();
    expect(libraryRepo.deleteFolder).not.toHaveBeenCalled();
  });

  it('update starts watcher when watch toggles on', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 7, type: 'books', name: 'Current', icon: 'BookOpen', watch: false }]);
    libraryRepo.update.mockResolvedValue([{ id: 7, name: 'Current', watch: true }]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 31, path: '/watched' }]);

    await service.update(7, { watch: true } as any);

    expect(fileWatcherService.startWatcher).toHaveBeenCalledWith(7, ['/watched']);
    expect(fileWatcherService.stopWatcher).not.toHaveBeenCalled();
  });

  it('update stops watcher when watch toggles off', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 8, type: 'books', name: 'Current', icon: 'BookOpen', watch: true }]);
    libraryRepo.update.mockResolvedValue([{ id: 8, name: 'Current', watch: false }]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 41, path: '/watched' }]);

    await service.update(8, { watch: false } as any);

    expect(fileWatcherService.stopWatcher).toHaveBeenCalledWith(8);
    expect(fileWatcherService.startWatcher).not.toHaveBeenCalled();
  });

  it('update rebinds watcher when folders change and watch remains on', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 9, type: 'books', name: 'Current', icon: 'BookOpen', watch: true }]);
    libraryRepo.update.mockResolvedValue([{ id: 9, name: 'Current', watch: true }]);
    libraryRepo.findFoldersByLibrary
      .mockResolvedValueOnce([
        { id: 1, path: '/keep' },
        { id: 2, path: '/remove' },
      ])
      .mockResolvedValueOnce([
        { id: 1, path: '/keep' },
        { id: 3, path: '/add' },
      ]);

    await service.update(9, { folders: ['/keep', '/add'] } as any);

    expect(fileWatcherService.startWatcher).toHaveBeenCalledWith(9, ['/keep', '/add']);
  });

  it('update triggers a background scan when format selection settings change', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 10, type: 'books', name: 'Current', icon: 'BookOpen', watch: false }]);
    libraryRepo.update.mockResolvedValue([{ id: 10, name: 'Current', watch: false }]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 1, path: '/books' }]);

    await service.update(10, { formatPriority: ['epub', 'pdf'], allowedFormats: ['epub'] } as any);

    expect(scannerService.startScanAsync).toHaveBeenCalledWith(10);
  });

  it('update replaces or disables the configured scan schedule', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 10, name: 'Current', icon: 'BookOpen', watch: false }]);
    libraryRepo.update.mockResolvedValue([{ id: 10, name: 'Current', icon: 'BookOpen', watch: false }]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 1, path: '/books' }]);

    await service.update(10, { autoScanCronExpression: '0 6 * * *' } as any);
    await service.update(10, { autoScanCronExpression: null } as any);

    expect(scanScheduler.syncSchedule).toHaveBeenNthCalledWith(1, 10, '0 6 * * *');
    expect(scanScheduler.syncSchedule).toHaveBeenNthCalledWith(2, 10, null);
  });

  it('update rejects book-only settings for podcast libraries', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 12, type: 'podcasts', name: 'Podcasts', icon: 'Podcast', watch: false }]);

    await expect(service.update(12, { autoScanCronExpression: '0 * * * *' } as any)).rejects.toThrow(
      'autoScanCronExpression is only supported for book libraries',
    );

    expect(libraryRepo.update).not.toHaveBeenCalled();
  });

  it('update changes podcast local-folder watching without invoking the book watcher', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 12, type: 'podcasts', name: 'Podcasts', icon: 'Podcast', watch: false, watchLocalFolders: true }]);
    libraryRepo.update.mockResolvedValue([{ id: 12, name: 'Podcasts', watchLocalFolders: false }]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 1, path: '/podcasts', role: 'downloads' }]);

    await service.update(12, { watchLocalFolders: false } as any);

    expect(libraryRepo.update).toHaveBeenCalledWith(12, { watchLocalFolders: false });
    expect(fileWatcherService.startWatcher).not.toHaveBeenCalled();
    expect(fileWatcherService.stopWatcher).not.toHaveBeenCalled();
  });

  it('update refuses a podcast storage-folder change while downloaded media exists', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 12, type: 'podcasts', name: 'Podcasts', icon: 'Podcast', watch: false }]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 1, path: '/podcasts-old', role: 'downloads' }]);
    libraryRepo.hasPodcastMediaFiles.mockResolvedValue(true);

    await expect(service.update(12, { folders: ['/podcasts-new'] } as any)).rejects.toThrow(
      'Remove downloaded podcast files before changing the podcast storage folder',
    );

    expect(libraryRepo.hasBlockingPodcastStorageJobs).not.toHaveBeenCalled();
    expect(libraryRepo.update).not.toHaveBeenCalled();
  });

  it('update adds a podcast local folder while downloaded media exists', async () => {
    // Nothing was ever written to a local root, so attaching one is not the storage move the
    // downloaded-media guard exists to refuse.
    libraryRepo.findById.mockResolvedValue([{ id: 12, type: 'podcasts', name: 'Podcasts', icon: 'Podcast', watch: false }]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 1, path: '/podcasts', role: 'downloads' }]);
    libraryRepo.hasPodcastMediaFiles.mockResolvedValue(true);
    libraryRepo.update.mockResolvedValue([{ id: 12, name: 'Podcasts' }]);

    await service.update(12, { localFolders: ['/archive'] } as any);

    expect(libraryRepo.insertFolders).toHaveBeenCalledWith([{ libraryId: 12, path: '/archive', role: 'local' }]);
    expect(libraryRepo.deleteFolder).not.toHaveBeenCalled();
  });

  it('update refuses a podcast storage-folder change while storage work is active', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 12, type: 'podcasts', name: 'Podcasts', icon: 'Podcast', watch: false }]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 1, path: '/podcasts-old', role: 'downloads' }]);
    libraryRepo.hasBlockingPodcastStorageJobs.mockResolvedValue(true);

    await expect(service.update(12, { folders: ['/podcasts-new'] } as any)).rejects.toThrow('Podcast storage work is in progress');

    expect(libraryRepo.cancelPodcastJobs).not.toHaveBeenCalled();
    expect(libraryRepo.update).not.toHaveBeenCalled();
  });

  it('update rejects organization mode changes after creation', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 10, name: 'Current', icon: 'BookOpen', watch: false, organizationMode: 'book_per_folder' }]);

    await expect(service.update(10, { organizationMode: 'book_per_file' } as any)).rejects.toThrow(BadRequestException);

    expect(libraryRepo.update).not.toHaveBeenCalled();
    expect(scannerService.startScanAsync).not.toHaveBeenCalled();
  });

  it('create rejects series from folders outside book_per_file', async () => {
    libraryRepo.findByName.mockResolvedValue([]);

    await expect(service.create({ name: 'BD', icon: 'BookOpen', folders: ['/a'], deriveSeriesFromFolder: true } as any)).rejects.toThrow(
      BadRequestException,
    );

    expect(libraryRepo.insert).not.toHaveBeenCalled();
  });

  it('create stores series from folders for a book_per_file library', async () => {
    libraryRepo.findByName.mockResolvedValue([]);
    libraryRepo.insert.mockResolvedValue([{ id: 5, type: 'books', name: 'BD', icon: 'BookOpen', organizationMode: 'book_per_file' }]);
    libraryRepo.insertFolders.mockResolvedValue([{ id: 11, path: '/a' }]);

    await service.create({ name: 'BD', icon: 'BookOpen', folders: ['/a'], organizationMode: 'book_per_file', deriveSeriesFromFolder: true } as any);

    expect(libraryRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ organizationMode: 'book_per_file', deriveSeriesFromFolder: true }));
  });

  it('create leaves series from folders off by default', async () => {
    libraryRepo.findByName.mockResolvedValue([]);
    libraryRepo.insert.mockResolvedValue([{ id: 5, type: 'books', name: 'Sci-Fi', icon: 'BookOpen' }]);
    libraryRepo.insertFolders.mockResolvedValue([{ id: 11, path: '/a' }]);

    await service.create({ name: 'Sci-Fi', icon: 'BookOpen', folders: ['/a'] } as any);

    expect(libraryRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ deriveSeriesFromFolder: false }));
  });

  it('update rejects series from folders on a book_per_folder library', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 10, name: 'Current', icon: 'BookOpen', watch: false, organizationMode: 'book_per_folder' }]);

    await expect(service.update(10, { deriveSeriesFromFolder: true } as any)).rejects.toThrow(BadRequestException);

    expect(libraryRepo.update).not.toHaveBeenCalled();
  });

  it('update rescans when series from folders is switched on', async () => {
    const existing = {
      id: 10,
      type: 'books',
      name: 'BD',
      icon: 'BookOpen',
      watch: false,
      organizationMode: 'book_per_file',
      deriveSeriesFromFolder: false,
    };
    libraryRepo.findById.mockResolvedValue([existing]);
    libraryRepo.update.mockResolvedValue([{ ...existing, deriveSeriesFromFolder: true }]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 1, path: '/books' }]);

    await service.update(10, { deriveSeriesFromFolder: true } as any);

    expect(libraryRepo.update).toHaveBeenCalledWith(10, { deriveSeriesFromFolder: true });
    expect(scannerService.startScanAsync).toHaveBeenCalledWith(10);
  });

  it('update does not rescan when series from folders is resent unchanged', async () => {
    const existing = {
      id: 10,
      type: 'books',
      name: 'BD',
      icon: 'BookOpen',
      watch: false,
      organizationMode: 'book_per_file',
      deriveSeriesFromFolder: true,
    };
    libraryRepo.findById.mockResolvedValue([existing]);
    libraryRepo.update.mockResolvedValue([existing]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 1, path: '/books' }]);

    await service.update(10, { deriveSeriesFromFolder: true } as any);

    expect(scannerService.startScanAsync).not.toHaveBeenCalled();
  });

  it('update accepts the same organization mode without triggering a scan', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 10, name: 'Current', icon: 'BookOpen', watch: false, organizationMode: 'book_per_file' }]);
    libraryRepo.update.mockResolvedValue([{ id: 10, name: 'Current', icon: 'BookOpen', watch: false, organizationMode: 'book_per_file' }]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 1, path: '/books' }]);

    const result = await service.update(10, { organizationMode: 'book_per_file' } as any);

    expect(libraryRepo.update).toHaveBeenCalledWith(10, { organizationMode: 'book_per_file' });
    expect(scannerService.startScanAsync).not.toHaveBeenCalled();
    expect(result.organizationMode).toBe('book_per_file');
  });

  it('update accepts the default organization mode for legacy rows without triggering a scan', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 10, name: 'Current', icon: 'BookOpen', watch: false, organizationMode: null }]);
    libraryRepo.update.mockResolvedValue([{ id: 10, name: 'Current', icon: 'BookOpen', watch: false, organizationMode: null }]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 1, path: '/books' }]);

    const result = await service.update(10, { organizationMode: 'book_per_folder' } as any);

    expect(libraryRepo.update).toHaveBeenCalledWith(10, { organizationMode: 'book_per_folder' });
    expect(scannerService.startScanAsync).not.toHaveBeenCalled();
    expect(result.organizationMode).toBe('book_per_folder');
  });

  it('update rejects changes that would leave a library without an icon', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 10, name: 'Current', icon: null, watch: false }]);

    await expect(service.update(10, { watch: true } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(libraryRepo.update).not.toHaveBeenCalled();
  });

  it('grantAccess emits library catalog changed event for the granted user', async () => {
    libraryRepo.grantAccess.mockResolvedValue({ libraryId: 4, userId: 21, accessLevel: 'read' });

    await service.grantAccess(4, { userId: 21, accessLevel: 'read' } as any);

    expect(achievementEvents.emit).toHaveBeenCalledWith(ACHIEVEMENT_EVENT_LIBRARY_CATALOG_CHANGED, { userId: 21, libraryId: 4 });
  });

  it('revokeAccess emits library catalog changed event for the revoked user', async () => {
    libraryRepo.revokeAccess.mockResolvedValue(undefined);

    await service.revokeAccess(4, 21);

    expect(achievementEvents.emit).toHaveBeenCalledWith(ACHIEVEMENT_EVENT_LIBRARY_CATALOG_CHANGED, { userId: 21, libraryId: 4 });
  });

  it('getAccess proxies to repository', async () => {
    libraryRepo.getAccessWithUsers.mockResolvedValue([{ userId: 1, accessLevel: 'read' }]);

    const result = await service.getAccess(9);

    expect(libraryRepo.getAccessWithUsers).toHaveBeenCalledWith(9);
    expect(result).toEqual([{ userId: 1, accessLevel: 'read' }]);
  });

  it('updateAccess proxies to repository', async () => {
    libraryRepo.updateAccess.mockResolvedValue({ libraryId: 9, userId: 1, accessLevel: 'write' });

    const result = await service.updateAccess(9, 1, 'write');

    expect(libraryRepo.updateAccess).toHaveBeenCalledWith(9, 1, 'write');
    expect(result).toEqual({ libraryId: 9, userId: 1, accessLevel: 'write' });
  });

  it('reorder proxies library order updates', async () => {
    libraryRepo.updateDisplayOrders.mockResolvedValue(undefined);

    await service.reorder({ order: [3, 1, 2] } as any);

    expect(libraryRepo.updateDisplayOrders).toHaveBeenCalledWith([3, 1, 2]);
  });

  it('remove deletes library and cleans related cover directories', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 4, name: 'L' }]);
    libraryRepo.findBookIdsByLibrary.mockResolvedValue([{ id: 101 }, { id: 102 }]);

    await service.remove(4);

    expect(fileWatcherService.stopWatcher).toHaveBeenCalledWith(4);
    expect(libraryRepo.delete).toHaveBeenCalledWith(4);
    expect(scanScheduler.removeSchedule).toHaveBeenCalledWith(4);
    expect(mockRm).toHaveBeenCalledWith('/books/covers/101', { recursive: true, force: true });
    expect(mockRm).toHaveBeenCalledWith('/books/covers/102', { recursive: true, force: true });
  });

  it('remove deletes downloaded podcast files before deleting the library', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 8, name: 'Podcasts', type: 'podcasts' }]);
    libraryRepo.findBookIdsByLibrary.mockResolvedValue([]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 1, path: '/podcasts' }]);
    mockStat.mockResolvedValue({ isFile: () => true } as Awaited<ReturnType<typeof stat>>);
    libraryRepo.findPodcastMediaFiles
      .mockResolvedValueOnce([
        { episodeId: 10, localPath: '/podcasts/one.mp3' },
        { episodeId: 11, localPath: '/podcasts/two.mp3' },
      ])
      .mockResolvedValueOnce([]);

    libraryRepo.findPodcastIds.mockResolvedValueOnce([{ id: 3 }]).mockResolvedValueOnce([]);

    await service.remove(8);

    expect(mockRm).toHaveBeenCalledWith('/podcasts/one.mp3', { force: true });
    expect(mockRm).toHaveBeenCalledWith('/podcasts/two.mp3', { force: true });
    expect(mockRm).toHaveBeenCalledWith('/books/podcast-artwork/3', { recursive: true, force: true });
    expect(mockRm).toHaveBeenCalledWith('/books/podcast-feeds/3.xml.gz', { force: true });
    expect(libraryRepo.delete).toHaveBeenCalledWith(8);
  });

  it('remove also deletes orphan files recorded by merge cleanup jobs', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 8, name: 'Podcasts', type: 'podcasts' }]);
    libraryRepo.findBookIdsByLibrary.mockResolvedValue([]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 1, path: '/podcasts' }]);
    libraryRepo.findPodcastMediaFiles.mockResolvedValue([]);
    libraryRepo.findPodcastCleanupJobs.mockResolvedValueOnce([{ id: 21, payload: { path: '/podcasts/orphan.mp3' } }]).mockResolvedValueOnce([]);
    mockStat.mockResolvedValue({ isFile: () => true } as Awaited<ReturnType<typeof stat>>);

    await service.remove(8);

    expect(mockRm).toHaveBeenCalledWith('/podcasts/orphan.mp3', { force: true });
    expect(libraryRepo.delete).toHaveBeenCalledWith(8);
  });

  it('remove refuses to delete a podcast media path outside its storage folder', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 8, name: 'Podcasts', type: 'podcasts' }]);
    libraryRepo.findBookIdsByLibrary.mockResolvedValue([]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 1, path: '/podcasts' }]);
    libraryRepo.findPodcastMediaFiles.mockResolvedValueOnce([{ episodeId: 10, localPath: '/path/to/outside-library/secret.mp3' }]);
    mockStat.mockResolvedValue({ isFile: () => true } as Awaited<ReturnType<typeof stat>>);

    await expect(service.remove(8)).rejects.toThrow('outside its library storage folder');

    expect(mockRm).not.toHaveBeenCalledWith('/path/to/outside-library/secret.mp3', { force: true });
    expect(libraryRepo.delete).not.toHaveBeenCalled();
  });

  it('remove waits for active podcast jobs to stop before deleting files or database rows', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 8, name: 'Podcasts', type: 'podcasts' }]);
    libraryRepo.cancelPodcastJobs.mockResolvedValue(1);

    await expect(service.remove(8)).rejects.toThrow('Podcast jobs are still stopping');

    expect(libraryRepo.findPodcastMediaFiles).not.toHaveBeenCalled();
    expect(libraryRepo.delete).not.toHaveBeenCalled();
  });

  /**
   * An unmounted drive or a folder renamed on disk left `realpath` throwing a raw ENOENT out of the
   * delete path, which surfaced as a 500 and made the library permanently undeletable.
   */
  it('remove still deletes a podcast library whose storage folder is gone from disk', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 9, name: 'Podcasts', type: 'podcasts' }]);
    libraryRepo.findBookIdsByLibrary.mockResolvedValue([]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 1, path: '/gone' }]);
    mockRealpath.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    libraryRepo.findPodcastMediaFiles.mockResolvedValue([]);
    libraryRepo.findPodcastIds.mockResolvedValue([]);

    await expect(service.remove(9)).resolves.not.toThrow();

    expect(libraryRepo.delete).toHaveBeenCalledWith(9);
  });

  it('remove names the missing storage folder rather than crashing when media rows still point into it', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 9, name: 'Podcasts', type: 'podcasts' }]);
    libraryRepo.findBookIdsByLibrary.mockResolvedValue([]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 1, path: '/gone' }]);
    mockRealpath.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    libraryRepo.findPodcastMediaFiles.mockResolvedValueOnce([{ episodeId: 10, localPath: '/gone/one.mp3' }]).mockResolvedValueOnce([]);

    await expect(service.remove(9)).rejects.toThrow(ConflictException);

    expect(libraryRepo.delete).not.toHaveBeenCalled();
  });

  it('remove still raises a storage failure that is not a missing folder', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 9, name: 'Podcasts', type: 'podcasts' }]);
    libraryRepo.findBookIdsByLibrary.mockResolvedValue([]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 1, path: '/denied' }]);
    mockRealpath.mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }));

    await expect(service.remove(9)).rejects.toThrow();

    expect(libraryRepo.delete).not.toHaveBeenCalled();
  });

  it('remove throws when library does not exist', async () => {
    libraryRepo.findById.mockResolvedValue([]);

    await expect(service.remove(99)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('prescan counts primary files recursively and flags overlapping paths', async () => {
    libraryRepo.findAllFolderPaths.mockResolvedValue([{ libraryId: 1, path: '/books/existing', libraryName: 'Existing Library' }]);

    mockReaddir.mockImplementation((path: Parameters<typeof readdir>[0]) => {
      if (path === '/books/new') {
        return Promise.resolve([dirent('a.epub', 'file'), dirent('.hidden.epub', 'file'), dirent('sub', 'dir')] as any);
      }
      if (path === '/books/new/sub') {
        return Promise.resolve([dirent('b.pdf', 'file'), dirent('note.txt', 'file')] as any);
      }
      return Promise.resolve([] as any);
    });

    mockIsPrimaryFormat.mockImplementation((path: string) => path.endsWith('.epub') || path.endsWith('.pdf'));

    const result = await service.prescan({ paths: ['/books/new', '/books/existing/sub'] } as any);

    expect(result.totalFiles).toBe(2);
    expect(result.paths[0]).toEqual(expect.objectContaining({ path: '/books/new', accessible: true, fileCount: 2 }));
    expect(result.paths[1]).toEqual(expect.objectContaining({ overlapLibrary: 'Existing Library' }));
  });

  it('prescan ignores persisted folders from the library being edited', async () => {
    libraryRepo.findAllFolderPaths.mockResolvedValue([
      { libraryId: 10, path: '/books/audiobooks', libraryName: 'Audiobooks' },
      { libraryId: 20, path: '/books/ebooks', libraryName: 'eBooks' },
    ]);

    const result = await service.prescan({ paths: ['/books/audiobooks'], libraryId: 10 });

    expect(result.paths[0]).toEqual({
      path: '/books/audiobooks',
      accessible: true,
      fileCount: 0,
      overlapLibrary: undefined,
      error: undefined,
    });
  });

  it('prescan still reports a different overlapping library after ignoring the edited library', async () => {
    libraryRepo.findAllFolderPaths.mockResolvedValue([
      { libraryId: 10, path: '/books/audiobooks', libraryName: 'Audiobooks' },
      { libraryId: 20, path: '/books', libraryName: 'All Books' },
    ]);

    const result = await service.prescan({ paths: ['/books/audiobooks'], libraryId: 10 });

    expect(result.paths[0]).toEqual(expect.objectContaining({ overlapLibrary: 'All Books' }));
  });

  it('prescan reports paths outside the configured browse root without touching the filesystem', async () => {
    libraryRepo.findAllFolderPaths.mockResolvedValue([]);
    pathPolicy.resolveBrowsePath.mockRejectedValue(new ForbiddenException('outside root'));

    const result = await service.prescan({ paths: ['/outside'] } as any);

    expect(result).toEqual({
      paths: [{ path: '/outside', accessible: false, fileCount: 0, error: 'Path is outside the configured library browse root' }],
      totalFiles: 0,
    });
    expect(mockStat).not.toHaveBeenCalled();
  });

  it('prescan reports non-directory paths with explicit error', async () => {
    libraryRepo.findAllFolderPaths.mockResolvedValue([]);
    mockStat.mockResolvedValue({ isDirectory: () => false } as Awaited<ReturnType<typeof stat>>);

    const result = await service.prescan({ paths: ['/tmp/file'] } as any);

    expect(result.paths[0]).toEqual({ path: '/tmp/file', accessible: false, fileCount: 0, error: 'Not a directory' });
  });

  it('prescan reports ENOENT paths with a sanitized message', async () => {
    libraryRepo.findAllFolderPaths.mockResolvedValue([]);
    mockStat.mockRejectedValue({ code: 'ENOENT' });

    const result = await service.prescan({ paths: ['/tmp/missing'] } as any);

    expect(result.paths[0]).toEqual(expect.objectContaining({ accessible: false, error: 'Path does not exist' }));
  });

  it('getOverview scopes to the caller and merges stats with the last scan', async () => {
    libraryRepo.findAccessibleIdsForUser.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    libraryRepo.getStatsForLibraries.mockResolvedValue(
      new Map([
        [1, { totalBooks: 381, totalSizeBytes: 727, formatCounts: { epub: 305 } }],
        [2, { totalBooks: 0, totalSizeBytes: 0, formatCounts: {} }],
      ]),
    );
    const lastScan = {
      status: 'completed' as const,
      triggeredBy: 'manual' as const,
      startedAt: '2026-08-23T00:00:00.000Z',
      completedAt: '2026-08-23T00:01:00.000Z',
      addedCount: 3,
      updatedCount: 0,
      missingCount: 0,
      errorMessage: null,
    };
    scannerService.getLatestScans.mockResolvedValue(new Map([[1, lastScan]]));

    const result = await service.getOverview({ id: 7, isSuperuser: false } as any);

    expect(libraryRepo.findAccessibleIdsForUser).toHaveBeenCalledWith(7);
    expect(libraryRepo.findAllIds).not.toHaveBeenCalled();
    expect(libraryRepo.getStatsForLibraries).toHaveBeenCalledWith([1, 2]);
    expect(result).toEqual([
      { libraryId: 1, totalBooks: 381, totalSizeBytes: 727, formatCounts: { epub: 305 }, lastScan },
      { libraryId: 2, totalBooks: 0, totalSizeBytes: 0, formatCounts: {}, lastScan: null },
    ]);
  });

  it('getOverview returns nothing and issues no queries when the caller has no libraries', async () => {
    libraryRepo.findAllIds.mockResolvedValue([]);

    const result = await service.getOverview({ id: 1, isSuperuser: true } as any);

    expect(result).toEqual([]);
    expect(libraryRepo.getStatsForLibraries).not.toHaveBeenCalled();
    expect(scannerService.getLatestScans).not.toHaveBeenCalled();
  });

  it('getOverview maps repository overflow errors to InternalServerErrorException', async () => {
    libraryRepo.findAllIds.mockResolvedValue([{ id: 1 }]);
    libraryRepo.getStatsForLibraries.mockRejectedValue(new RangeError('overflow'));

    await expect(service.getOverview({ id: 1, isSuperuser: true } as any)).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('getStats maps repository overflow errors to InternalServerErrorException', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 1, name: 'L' }]);
    libraryRepo.getStats.mockRejectedValue(new RangeError('overflow'));

    await expect(service.getStats(1)).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('writeMetadataToFiles blocks non-dry-run when file write is disabled', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 1, name: 'L', fileWriteEnabled: false }]);

    await expect(service.writeMetadataToFiles(1, 7, false)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('writeMetadataToFiles throws when the library does not exist', async () => {
    libraryRepo.findById.mockResolvedValue([]);

    await expect(service.writeMetadataToFiles(404, 7, true)).rejects.toBeInstanceOf(NotFoundException);
    expect(fileWriteService.findNonMissingPrimaryFilesByLibrary).not.toHaveBeenCalled();
  });

  it('writeMetadataToFiles emits progress and returns summary counters', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 1, name: 'L', fileWriteEnabled: true }]);
    fileWriteService.findNonMissingPrimaryFilesByLibrary.mockResolvedValue([{ bookId: 1 }, { bookId: 2 }, { bookId: 3 }]);
    fileWriteService.writeToFile
      .mockResolvedValueOnce({ status: 'success', fieldsWritten: [], durationMs: 1 })
      .mockResolvedValueOnce({ status: 'failed', fieldsWritten: [], durationMs: 1, reason: 'write failed' })
      .mockResolvedValueOnce({ status: 'skipped', fieldsWritten: [], durationMs: 1, reason: 'no changes' });

    const onProgress = vi.fn();
    const summary = await service.writeMetadataToFiles(1, 7, false, { onProgress });

    expect(summary).toEqual({ processed: 3, succeeded: 1, failed: 1, skipped: 1, cancelled: false });
    expect(onProgress).toHaveBeenNthCalledWith(1, { bookId: 1, status: 'success', reason: undefined });
    expect(onProgress).toHaveBeenNthCalledWith(2, { bookId: 2, status: 'failed', reason: 'write failed' });
    expect(onProgress).toHaveBeenNthCalledWith(3, { bookId: 3, status: 'skipped', reason: 'no changes' });
  });

  it('writeMetadataToFiles converts thrown write errors into failed results', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 1, name: 'L', fileWriteEnabled: true }]);
    fileWriteService.findNonMissingPrimaryFilesByLibrary.mockResolvedValue([{ bookId: 1 }]);
    fileWriteService.writeToFile.mockRejectedValue('disk offline');

    const summary = await service.writeMetadataToFiles(1, 7, false);

    expect(summary).toEqual({ processed: 1, succeeded: 0, failed: 1, skipped: 0, cancelled: false });
  });

  it('writeMetadataToFiles stops when cancellation is requested', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 1, name: 'L', fileWriteEnabled: true }]);
    fileWriteService.findNonMissingPrimaryFilesByLibrary.mockResolvedValue([{ bookId: 1 }, { bookId: 2 }]);
    fileWriteService.writeToFile.mockResolvedValue({ status: 'success', fieldsWritten: [], durationMs: 1 });

    let isCancelled = false;
    const summary = await service.writeMetadataToFiles(1, 7, false, {
      onProgress: () => {
        isCancelled = true;
      },
      isCancelled: () => isCancelled,
    });

    expect(fileWriteService.writeToFile).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({ processed: 1, succeeded: 1, failed: 0, skipped: 0, cancelled: true });
  });
});
