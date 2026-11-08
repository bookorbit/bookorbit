import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { UpdateLibraryDto } from './dto/update-library.dto';
import { ReadingAttemptEventsService } from '../user-book-status/reading-attempt-events.service';
vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  realpath: vi.fn(),
  rm: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('../scanner/lib/classify', () => ({
  isPrimaryFormat: vi.fn(),
}));

import { BadRequestException, ConflictException, ForbiddenException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { EMPTY_CONTENT_FILTER_RULES, FOLDER_SERIES_REGEX_METADATA } from '@bookorbit/types';
import { readdir, rm, stat } from 'fs/promises';

import { ACHIEVEMENT_EVENT_LIBRARY_CATALOG_CHANGED } from '../achievement/achievement-events.service';
import { isPrimaryFormat } from '../scanner/lib/classify';
import { LibraryOperationGate } from '../../common/services/library-operation-gate.service';
import { LibraryScopeService } from '../../common/library-scope/library-scope.service';
import { LibraryService } from './library.service';

const mockReaddir = readdir as MockedFunction<typeof readdir>;
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
  const scopeRepo = {
    findAllIds: vi.fn(),
    findExistingIds: vi.fn(),
    findGrantedLevels: vi.fn(),
    findGrantedLevel: vi.fn(),
    findIsSuperuser: vi.fn(),
  };
  const libraryRepo = {
    findAll: vi.fn(),
    findAllForUser: vi.fn(),
    findAllFolders: vi.fn(),
    findFoldersByLibraryIds: vi.fn(),
    findById: vi.fn(),
    findByIds: vi.fn(),
    findFoldersByLibrary: vi.fn(),
    findByName: vi.fn(),
    insert: vi.fn(),
    insertFolders: vi.fn(),
    update: vi.fn(),
    deleteFolder: vi.fn(),
    findBookIdsByLibrary: vi.fn(),
    delete: vi.fn(),
    findAllFolderPaths: vi.fn().mockResolvedValue([]),
    getStats: vi.fn(),
    getStatsForLibraries: vi.fn(),
    updateDisplayOrders: vi.fn(),
    getAccessWithUsers: vi.fn(),
    grantAccess: vi.fn(),
    updateAccess: vi.fn(),
    revokeAccess: vi.fn(),
  };

  const config = { get: vi.fn().mockReturnValue('/books') };
  const scannerService = { startScanAsync: vi.fn(), getLatestScans: vi.fn(), forgetLibraryRoots: vi.fn() };
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

  const regexMetadata = { validate: vi.fn() };
  let service: LibraryService;
  let readingEvents: ReadingAttemptEventsService;
  let libraryGate: LibraryOperationGate;

  beforeEach(() => {
    vi.resetAllMocks();
    config.get.mockReturnValue('/books');
    readingEvents = new ReadingAttemptEventsService();
    libraryGate = new LibraryOperationGate();
    service = new LibraryService(
      libraryRepo as any,
      config as any,
      scannerService as any,
      fileWatcherService as any,
      fileWriteService as any,
      achievementEvents as any,
      pathPolicy as any,
      scanScheduler as any,
      regexMetadata as any,
      readingEvents,
      libraryGate,
      new LibraryScopeService(scopeRepo as any),
    );

    libraryRepo.findById.mockResolvedValue([{ id: 1 }]);
    libraryRepo.findAllFolderPaths.mockResolvedValue([]);
    libraryRepo.findByIds.mockImplementation((ids: number[]) => Promise.resolve(ids.map((id) => ({ id }))));
    mockStat.mockResolvedValue({ isDirectory: () => true } as Awaited<ReturnType<typeof stat>>);
    mockReaddir.mockResolvedValue([] as unknown as Awaited<ReturnType<typeof readdir>>);
    mockRm.mockResolvedValue(undefined);
    mockIsPrimaryFormat.mockReturnValue(false);
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
    scopeRepo.findAllIds.mockResolvedValue([1, 2]);
    scopeRepo.findGrantedLevels.mockResolvedValue([
      { id: 3, accessLevel: 'viewer' },
      { id: 4, accessLevel: 'editor' },
    ]);

    await expect(service.findAccessibleLibraryIds({ id: 99, isSuperuser: true, contentFilters: EMPTY_CONTENT_FILTER_RULES } as any)).resolves.toEqual(
      [1, 2],
    );
    await expect(
      service.findAccessibleLibraryIds({ id: 42, isSuperuser: false, contentFilters: EMPTY_CONTENT_FILTER_RULES } as any),
    ).resolves.toEqual([3, 4]);
  });

  it('findEditableLibraryIds reads all IDs for superusers and editor-or-owner IDs for normal users', async () => {
    scopeRepo.findAllIds.mockResolvedValue([1, 2]);
    scopeRepo.findGrantedLevels.mockResolvedValue([{ id: 4, accessLevel: 'editor' }]);

    await expect(service.findEditableLibraryIds({ id: 99, isSuperuser: true, contentFilters: EMPTY_CONTENT_FILTER_RULES } as any)).resolves.toEqual([
      1, 2,
    ]);
    expect(scopeRepo.findGrantedLevels).not.toHaveBeenCalled();

    await expect(service.findEditableLibraryIds({ id: 42, isSuperuser: false, contentFilters: EMPTY_CONTENT_FILTER_RULES } as any)).resolves.toEqual([
      4,
    ]);
    expect(scopeRepo.findGrantedLevels).toHaveBeenCalledWith(42, ['editor', 'owner']);
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

  it('rejects regex validation for a library that does not exist', async () => {
    libraryRepo.findById.mockResolvedValue([]);
    await expect(service.validateRegexMetadata({ config: { rules: [{ pattern: '(?<title>.+)', flags: '' }] }, libraryId: 2 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe('regex configuration updates', () => {
    const first = { pattern: '(?<title>.+)', flags: 'i' };
    const second = { pattern: '(?<series>.+)', flags: '' };
    const config = { rules: [first, second] };
    beforeEach(() => {
      libraryRepo.findById.mockResolvedValue([{ id: 2, icon: 'BookOpen', regexMetadata: config }]);
      libraryRepo.update.mockResolvedValue([{ id: 2 }]);
      libraryRepo.findFoldersByLibrary.mockResolvedValue([]);
    });

    it.each([null, { rules: [{ flags: 'i', pattern: first.pattern }, second] }])(
      'does not revalidate or rewrite unchanged rules: %j',
      async (unchanged) => {
        libraryRepo.findById.mockResolvedValue([{ id: 2, icon: 'BookOpen', regexMetadata: unchanged === null ? null : config }]);
        await service.update(2, plainToInstance(UpdateLibraryDto, { coverAspectRatio: '1/1', regexMetadata: unchanged }));
        expect(regexMetadata.validate).not.toHaveBeenCalled();
        expect(libraryRepo.update).toHaveBeenCalledWith(2, { coverAspectRatio: '1/1' });
      },
    );

    it.each([
      null,
      { rules: [second, first] },
      { rules: [{ ...first, flags: 'u' }, second] },
      { rules: [{ ...first, pattern: '(?<title>.*)' }, second] },
    ])('validates and persists an actual change without a library grant: %j', async (changed) => {
      await service.update(2, { regexMetadata: changed });
      expect(scopeRepo.findGrantedLevel).not.toHaveBeenCalled();
      expect(regexMetadata.validate).toHaveBeenCalledWith(changed);
      expect(libraryRepo.update).toHaveBeenCalledWith(2, { regexMetadata: changed });
    });

    it('stores a preset as its current rules, whatever rules came with it', async () => {
      await service.update(2, { regexMetadata: { preset: 'folder_series', rules: [first, second] } });
      expect(regexMetadata.validate).toHaveBeenCalledWith(FOLDER_SERIES_REGEX_METADATA);
      expect(libraryRepo.update).toHaveBeenCalledWith(2, { regexMetadata: FOLDER_SERIES_REGEX_METADATA });
    });

    it('treats a re-sent preset as unchanged after the preset itself changed', async () => {
      libraryRepo.findById.mockResolvedValue([{ id: 2, icon: 'BookOpen', regexMetadata: { preset: 'folder_series', rules: [first] } }]);
      await service.update(2, plainToInstance(UpdateLibraryDto, { coverAspectRatio: '1/1', regexMetadata: FOLDER_SERIES_REGEX_METADATA }));
      expect(regexMetadata.validate).not.toHaveBeenCalled();
      expect(libraryRepo.update).toHaveBeenCalledWith(2, { coverAspectRatio: '1/1' });
    });

    it('does not persist a change that fails validation', async () => {
      regexMetadata.validate.mockRejectedValueOnce(new BadRequestException('Invalid regex metadata configuration'));
      await expect(service.update(2, { regexMetadata: null })).rejects.toThrow('Invalid regex metadata configuration');
      expect(libraryRepo.update).not.toHaveBeenCalled();
    });
  });

  it('verifyAccess bypasses lookup for superusers', async () => {
    await service.verifyAccess({ id: 1, isSuperuser: true }, 2);
    expect(scopeRepo.findGrantedLevel).not.toHaveBeenCalled();
  });

  it('verifyAccess throws when user has no library access', async () => {
    scopeRepo.findGrantedLevel.mockResolvedValue(null);
    await expect(service.verifyAccess({ id: 1, isSuperuser: false }, 2)).rejects.toThrow('No access to this library');
  });

  it('verifyAccessLevel enforces the required library role', async () => {
    scopeRepo.findGrantedLevel.mockResolvedValue('viewer');

    await expect(service.verifyAccessLevel({ id: 1, isSuperuser: false }, 2, 'editor')).rejects.toThrow('Insufficient library access level');
    await expect(service.verifyAccessLevel({ id: 1, isSuperuser: true }, 2, 'owner')).resolves.toBeUndefined();
  });

  it('findAll narrows a library-limited API key to its libraries and caps a read key at viewer', async () => {
    scopeRepo.findGrantedLevels.mockResolvedValue([
      { id: 10, accessLevel: 'editor' },
      { id: 11, accessLevel: 'viewer' },
    ]);
    libraryRepo.findAllForUser.mockResolvedValue([
      { id: 10, name: 'A', accessLevel: 'editor' },
      { id: 11, name: 'B', accessLevel: 'viewer' },
    ]);
    libraryRepo.findFoldersByLibraryIds.mockResolvedValue([]);
    const credential = { kind: 'api_key', keyId: 1, keyName: 'k', audience: 'api', access: 'read', libraryIds: [10], ownerIsSuperuser: false };

    const result = await service.findAll({ id: 7, isSuperuser: false, contentFilters: EMPTY_CONTENT_FILTER_RULES, credential } as any);

    expect(result.map(({ id, accessLevel }: any) => ({ id, accessLevel }))).toEqual([{ id: 10, accessLevel: 'viewer' }]);
  });

  it.each([undefined, ['regex', 'embedded']])('preserves regex configuration with precedence %j on create', async (metadataPrecedence) => {
    const config = { rules: [{ pattern: '(?<title>.+)', flags: '' }] };
    libraryRepo.findByName.mockResolvedValue([]);
    libraryRepo.insert.mockResolvedValue([{ id: 5, name: 'Regex', icon: 'BookOpen' }]);
    libraryRepo.insertFolders.mockResolvedValue([]);
    await service.create({ name: 'Regex', icon: 'BookOpen', folders: ['/a'], regexMetadata: config, metadataPrecedence });
    expect(libraryRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        regexMetadata: config,
        metadataPrecedence: metadataPrecedence ?? ['folderStructure', 'embedded', 'nfoFile', 'opfFile', 'sidecar', 'regex'],
      }),
    );
  });

  it('create applies defaults, inserts folders, and starts an async scan', async () => {
    libraryRepo.findByName.mockResolvedValue([]);
    libraryRepo.insert.mockResolvedValue([{ id: 5, name: 'Sci-Fi', icon: 'BookOpen' }]);
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
        metadataPrecedence: ['folderStructure', 'embedded', 'nfoFile', 'opfFile', 'sidecar', 'regex'],
        formatPriority: [
          'epub',
          'kepub',
          'pdf',
          'cbz',
          'cbr',
          'cb7',
          'mobi',
          'azw3',
          'azw',
          'fb2',
          'djvu',
          'm4b',
          'mp3',
          'm4a',
          'opus',
          'ogg',
          'flac',
        ],
        organizationMode: 'book_per_folder',
        coverAspectRatio: '2/3',
      }),
    );
    expect(scannerService.startScanAsync).toHaveBeenCalledWith(5);
    expect(fileWatcherService.startWatcher).not.toHaveBeenCalled();
    expect(libraryRepo.insertFolders).toHaveBeenCalledWith([
      { libraryId: 5, path: '/a' },
      { libraryId: 5, path: '/b' },
    ]);
    expect(result.folders).toEqual([
      { id: 11, path: '/a' },
      { id: 12, path: '/b' },
    ]);
  });

  it('create passes file write defaults to insert', async () => {
    libraryRepo.findByName.mockResolvedValue([]);
    libraryRepo.insert.mockResolvedValue([{ id: 5, name: 'Sci-Fi', icon: 'BookOpen' }]);
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
        fileWriteAllFiles: false,
        fileWriteReadAlongEnabled: false,
        fileWriteReadAlongMaxFileSizeMb: 1000,
        fileRenameEnabled: false,
      }),
    );
  });

  it('create stores the all-files write scope when asked', async () => {
    libraryRepo.findByName.mockResolvedValue([]);
    libraryRepo.insert.mockResolvedValue([{ id: 5, name: 'Mixed', icon: 'BookOpen' }]);
    libraryRepo.insertFolders.mockResolvedValue([{ id: 11, path: '/a' }]);

    await service.create({ name: 'Mixed', icon: 'BookOpen', folders: ['/a'], fileWriteAllFiles: true } as any);

    expect(libraryRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ fileWriteAllFiles: true }));
  });

  it('update leaves the stored all-files write scope alone when the request omits it', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 10, name: 'Current', icon: 'BookOpen', watch: false, fileWriteAllFiles: true }]);
    libraryRepo.update.mockResolvedValue([{ id: 10, name: 'Current', icon: 'BookOpen', watch: false, fileWriteAllFiles: true }]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 1, path: '/books' }]);

    await service.update(10, { fileWriteEnabled: true } as any);

    expect(libraryRepo.update).toHaveBeenCalledWith(10, { fileWriteEnabled: true });
  });

  it('create starts watcher immediately when watch is enabled', async () => {
    libraryRepo.findByName.mockResolvedValue([]);
    libraryRepo.insert.mockResolvedValue([{ id: 6, name: 'Watched', icon: 'BookOpen', watch: true }]);
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
        { id: 1, path: '/keep' },
        { id: 2, path: '/remove' },
      ])
      .mockResolvedValueOnce([
        { id: 1, path: '/keep' },
        { id: 3, path: '/add' },
      ]);

    await service.update(3, { folders: ['/keep', '/add'] } as any);

    expect(libraryRepo.deleteFolder).toHaveBeenCalledWith(2);
    expect(libraryRepo.insertFolders).toHaveBeenCalledWith([{ libraryId: 3, path: '/add' }]);
    expect(fileWatcherService.startWatcher).not.toHaveBeenCalled();
    expect(fileWatcherService.stopWatcher).not.toHaveBeenCalled();
  });

  describe('overlapping folders', () => {
    const others = [
      { libraryId: 7, path: '/media/books', libraryName: 'Books' },
      { libraryId: 3, path: '/media/audio', libraryName: 'Current' },
      { libraryId: 3, path: '/media/audio/podcasts', libraryName: 'Current' },
    ];

    beforeEach(() => {
      libraryRepo.findAllFolderPaths.mockResolvedValue(others);
      libraryRepo.findByName.mockResolvedValue([]);
      libraryRepo.findById.mockResolvedValue([{ id: 3, name: 'Current', icon: 'BookOpen', watch: false }]);
      libraryRepo.update.mockResolvedValue([{ id: 3, name: 'Current' }]);
      libraryRepo.findFoldersByLibrary.mockResolvedValue([
        { id: 1, path: '/media/audio' },
        { id: 2, path: '/media/audio/podcasts' },
      ]);
    });

    async function refusal(promise: Promise<unknown>) {
      const error = await promise.then(
        () => null,
        (err: unknown) => err,
      );
      expect(error).toBeInstanceOf(ConflictException);
      return (error as ConflictException).getResponse();
    }

    it.each([
      ['inside another library folder', '/media/books/comics', '/media/books'],
      ['around another library folder', '/media', '/media/books'],
      ['on another library folder', '/media/books', '/media/books'],
    ])('refuses a new library with a folder %s', async (_case, path, overlapPath) => {
      await expect(refusal(service.create({ name: 'New', icon: 'BookOpen', folders: [path] } as any))).resolves.toMatchObject({
        errorCode: 'LIBRARY_FOLDER_OVERLAP',
        errorMeta: { path, overlapPath, overlapLibrary: 'Books' },
      });
      expect(libraryRepo.insert).not.toHaveBeenCalled();
    });

    it('refuses a new library whose own folders sit inside one another', async () => {
      await expect(
        refusal(service.create({ name: 'New', icon: 'BookOpen', folders: ['/srv/comics', '/srv/comics/manga'] } as any)),
      ).resolves.toMatchObject({ errorCode: 'LIBRARY_FOLDER_OVERLAP', errorMeta: { path: '/srv/comics', overlapPath: '/srv/comics/manga' } });
      expect(libraryRepo.insert).not.toHaveBeenCalled();
    });

    it('accepts a folder that only shares a name prefix with another', async () => {
      libraryRepo.insert.mockResolvedValue([{ id: 9, name: 'New', icon: 'BookOpen' }]);
      libraryRepo.insertFolders.mockResolvedValue([{ id: 20, path: '/media/books2' }]);

      await expect(service.create({ name: 'New', icon: 'BookOpen', folders: ['/media/books2'] } as any)).resolves.toBeDefined();
    });

    it('refuses an added folder that overlaps another folder of the same library before changing anything', async () => {
      await expect(
        refusal(service.update(3, { name: 'Renamed', folders: ['/media/audio', '/media/audio/podcasts', '/media/audio/books'] } as any)),
      ).resolves.toMatchObject({ errorCode: 'LIBRARY_FOLDER_OVERLAP', errorMeta: { path: '/media/audio/books', overlapPath: '/media/audio' } });
      expect(libraryRepo.update).not.toHaveBeenCalled();
      expect(libraryRepo.insertFolders).not.toHaveBeenCalled();
    });

    it('keeps saving a library whose folders overlapped before the rule, and drops the cached folder list only when they change', async () => {
      await service.update(3, { name: 'Renamed', folders: ['/media/audio', '/media/audio/podcasts'] } as any);
      expect(libraryRepo.update).toHaveBeenCalled();
      expect(scannerService.forgetLibraryRoots).not.toHaveBeenCalled();

      await service.update(3, { folders: ['/media/audio'] } as any);
      expect(libraryRepo.deleteFolder).toHaveBeenCalledWith(2);
      expect(scannerService.forgetLibraryRoots).toHaveBeenCalledTimes(1);
    });
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
    libraryRepo.findById.mockResolvedValue([{ id: 7, name: 'Current', icon: 'BookOpen', watch: false }]);
    libraryRepo.update.mockResolvedValue([{ id: 7, name: 'Current', watch: true }]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 31, path: '/watched' }]);

    await service.update(7, { watch: true } as any);

    expect(fileWatcherService.startWatcher).toHaveBeenCalledWith(7, ['/watched']);
    expect(fileWatcherService.stopWatcher).not.toHaveBeenCalled();
  });

  it('update stops watcher when watch toggles off', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 8, name: 'Current', icon: 'BookOpen', watch: true }]);
    libraryRepo.update.mockResolvedValue([{ id: 8, name: 'Current', watch: false }]);
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ id: 41, path: '/watched' }]);

    await service.update(8, { watch: false } as any);

    expect(fileWatcherService.stopWatcher).toHaveBeenCalledWith(8);
    expect(fileWatcherService.startWatcher).not.toHaveBeenCalled();
  });

  it('update rebinds watcher when folders change and watch remains on', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 9, name: 'Current', icon: 'BookOpen', watch: true }]);
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
    libraryRepo.findById.mockResolvedValue([{ id: 10, name: 'Current', icon: 'BookOpen', watch: false }]);
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

  it('update rejects organization mode changes after creation', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 10, name: 'Current', icon: 'BookOpen', watch: false, organizationMode: 'book_per_folder' }]);

    await expect(service.update(10, { organizationMode: 'book_per_file' } as any)).rejects.toThrow(BadRequestException);

    expect(libraryRepo.update).not.toHaveBeenCalled();
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

    const notify = vi.spyOn(readingEvents, 'notifyChanged');
    libraryRepo.delete.mockImplementation(() => {
      expect(notify).not.toHaveBeenCalled();
      return Promise.resolve();
    });
    await service.remove(4);
    expect(notify).toHaveBeenCalledExactlyOnceWith(null);

    expect(fileWatcherService.stopWatcher).toHaveBeenCalledWith(4);
    expect(libraryRepo.delete).toHaveBeenCalledWith(4);
    expect(scanScheduler.removeSchedule).toHaveBeenCalledWith(4);
    expect(mockRm).toHaveBeenCalledWith('/books/covers/101', { recursive: true, force: true });
    expect(mockRm).toHaveBeenCalledWith('/books/covers/102', { recursive: true, force: true });
  });

  it('does not invalidate reading caches when deleting the library fails', async () => {
    libraryRepo.findBookIdsByLibrary.mockResolvedValue([]);
    libraryRepo.delete.mockRejectedValueOnce(new Error('Delete failed'));
    const notify = vi.spyOn(readingEvents, 'notifyChanged');
    await expect(service.remove(1)).rejects.toThrow('Delete failed');
    expect(notify).not.toHaveBeenCalled();
  });

  it('refuses to delete a library while another operation holds it, with a code the client translates', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 4, name: 'L' }]);
    const releaseScan = libraryGate.tryAcquire(4, 'scan')!;

    const refusal = await service.remove(4).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ConflictException);
    expect((refusal as ConflictException).getResponse()).toMatchObject({ errorCode: 'LIBRARY_BUSY' });
    expect(fileWatcherService.stopWatcher).not.toHaveBeenCalled();
    expect(libraryRepo.delete).not.toHaveBeenCalled();
    expect(libraryGate.current(4)).toBe('scan');
    releaseScan();
  });

  it('holds the library for the whole delete and frees it afterwards, whether the delete succeeds or fails', async () => {
    libraryRepo.findById.mockResolvedValue([{ id: 4, name: 'L' }]);
    libraryRepo.findBookIdsByLibrary.mockResolvedValue([]);
    const heldDuringDelete: Array<string | null> = [];
    libraryRepo.delete.mockImplementation(() => {
      heldDuringDelete.push(libraryGate.current(4));
      return Promise.resolve();
    });

    await service.remove(4);
    expect(heldDuringDelete).toEqual(['library_delete']);
    expect(libraryGate.isHeld(4)).toBe(false);

    libraryRepo.delete.mockRejectedValueOnce(new Error('Delete failed'));
    await expect(service.remove(4)).rejects.toThrow('Delete failed');
    expect(libraryGate.isHeld(4)).toBe(false);
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
    scopeRepo.findGrantedLevels.mockResolvedValue([
      { id: 1, accessLevel: 'viewer' },
      { id: 2, accessLevel: 'viewer' },
    ]);
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

    expect(scopeRepo.findGrantedLevels).toHaveBeenCalledWith(7, undefined);
    expect(scopeRepo.findAllIds).not.toHaveBeenCalled();
    expect(libraryRepo.getStatsForLibraries).toHaveBeenCalledWith([1, 2]);
    expect(result).toEqual([
      { libraryId: 1, totalBooks: 381, totalSizeBytes: 727, formatCounts: { epub: 305 }, lastScan },
      { libraryId: 2, totalBooks: 0, totalSizeBytes: 0, formatCounts: {}, lastScan: null },
    ]);
  });

  it('getOverview returns nothing and issues no queries when the caller has no libraries', async () => {
    scopeRepo.findAllIds.mockResolvedValue([]);

    const result = await service.getOverview({ id: 1, isSuperuser: true } as any);

    expect(result).toEqual([]);
    expect(libraryRepo.getStatsForLibraries).not.toHaveBeenCalled();
    expect(scannerService.getLatestScans).not.toHaveBeenCalled();
  });

  it('getOverview maps repository overflow errors to InternalServerErrorException', async () => {
    scopeRepo.findAllIds.mockResolvedValue([1]);
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
