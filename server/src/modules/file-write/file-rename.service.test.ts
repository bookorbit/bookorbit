import { ConfigService } from '@nestjs/config';
import { NotificationType } from '@bookorbit/types';
import type { MockedFunction } from 'vitest';
import { access, mkdir, readdir, rename as fsRename, rmdir } from 'fs/promises';

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    access: vi.fn(),
    mkdir: vi.fn(),
    readdir: vi.fn(),
    rename: vi.fn(),
    rmdir: vi.fn(),
  };
});

import type { BookRenameData } from './file-rename.repository';
import { FileRenameService } from './file-rename.service';

const mockAccess = access as MockedFunction<typeof access>;
const mockMkdir = mkdir as MockedFunction<typeof mkdir>;
const mockReaddir = readdir as MockedFunction<typeof readdir>;
const mockRename = fsRename as MockedFunction<typeof fsRename>;
const mockRmdir = rmdir as MockedFunction<typeof rmdir>;

type RenameDataOverrides = Partial<BookRenameData> & {
  file?: Partial<BookRenameData['file']>;
  metadata?: Partial<BookRenameData['metadata']>;
};

describe('FileRenameService', () => {
  function makeRenameData(overrides: RenameDataOverrides = {}): BookRenameData {
    const base: BookRenameData = {
      file: {
        id: 10,
        absolutePath: '/library/old-folder/Old Title.epub',
        relPath: 'old-folder/Old Title.epub',
        format: 'epub',
        role: 'primary',
      },
      libraryId: 1,
      libraryFolderId: 2,
      libraryFolderPath: '/library',
      organizationMode: 'book_per_file',
      fileRenameEnabled: true,
      fileNamingPattern: '{authors}/{title}',
      bookFolderPath: '/library/old-folder/Old Title.epub',
      metadata: {
        title: 'Dune',
        subtitle: null,
        publisher: 'Ace',
        language: 'en',
        isbn13: '9780441172719',
        publishedYear: 1965,
        seriesName: null,
        seriesIndex: null,
      },
      authors: ['Frank Herbert'],
    };

    return {
      ...base,
      ...overrides,
      file: { ...base.file, ...overrides.file },
      metadata: { ...base.metadata, ...overrides.metadata },
      authors: overrides.authors ?? base.authors,
    };
  }

  function makeService(configValues: Record<string, unknown> = {}) {
    const renameRepo = {
      findBookRenameData: vi.fn(),
      checkPathTakenByOtherBook: vi.fn().mockResolvedValue(false),
      applyFileRename: vi.fn().mockResolvedValue(undefined),
      applyFolderRename: vi.fn().mockResolvedValue(undefined),
      findAllBookFiles: vi.fn().mockResolvedValue([]),
    };
    const lockService = {
      withLock: vi.fn().mockImplementation(async (_path: string, fn: () => Promise<unknown>) => fn()),
    };
    const appSettings = {
      getUploadPattern: vi.fn().mockResolvedValue('{authors}/{title}'),
      getUploadPatternBookPerFolder: vi.fn().mockResolvedValue('{authors}/{title}/{title}'),
    };
    const notificationService = {
      notify: vi.fn().mockResolvedValue(undefined),
    };
    const config = {
      get: vi.fn().mockImplementation((key: string) => configValues[key]),
    } as unknown as ConfigService;

    const service = new FileRenameService(renameRepo as never, lockService as never, appSettings as never, notificationService as never, config);

    return { service, renameRepo, lockService, appSettings, notificationService };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockAccess.mockReset();
    mockMkdir.mockReset();
    mockReaddir.mockReset();
    mockRename.mockReset();
    mockRmdir.mockReset();
    mockAccess.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }) as never);
    mockMkdir.mockResolvedValue(undefined as never);
    mockReaddir.mockResolvedValue(['still-here'] as never);
    mockRename.mockResolvedValue(undefined as never);
    mockRmdir.mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces scheduled renames per book and keeps the latest user id', async () => {
    vi.useFakeTimers();
    const { service } = makeService({ 'fileWrite.debounceMs': 25 });
    const performRename = vi.spyOn(service, 'performRename').mockResolvedValue({
      status: 'skipped',
      reason: 'disabled',
      durationMs: 0,
    });

    service.scheduleRename(7, 1);
    service.scheduleRename(7, 2);

    await vi.advanceTimersByTimeAsync(24);
    expect(performRename).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await service.drainScheduledRenamesForTests();

    expect(performRename).toHaveBeenCalledTimes(1);
    expect(performRename).toHaveBeenCalledWith(7, 2);
  });

  it('skips when file renaming is disabled for the library', async () => {
    const { service, renameRepo, notificationService } = makeService();
    renameRepo.findBookRenameData.mockResolvedValue(makeRenameData({ fileRenameEnabled: false }));

    await expect(service.performRename(5, 12)).resolves.toEqual(expect.objectContaining({ status: 'skipped', reason: 'disabled' }));
    expect(notificationService.notify).not.toHaveBeenCalled();
  });

  it('skips and notifies when another book already owns the target path', async () => {
    const { service, renameRepo, notificationService } = makeService();
    renameRepo.findBookRenameData.mockResolvedValue(
      makeRenameData({
        file: {
          absolutePath: '/library/Old Title.epub',
          relPath: 'Old Title.epub',
        },
        metadata: { title: 'New Title' },
        bookFolderPath: '/library/Old Title.epub',
      }),
    );
    renameRepo.checkPathTakenByOtherBook.mockResolvedValue(true);

    const result = await service.performRename(5, 12);

    expect(result).toEqual(
      expect.objectContaining({
        status: 'skipped',
        reason: 'collision',
        oldPath: '/library/Old Title.epub',
        newPath: '/library/Frank Herbert/New Title.epub',
      }),
    );
    expect(notificationService.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.FileRenameFailed,
        scope: { kind: 'user', userId: 12 },
        meta: { bookId: 5 },
      }),
    );
  });

  it('renames a single file after updating database paths first', async () => {
    const { service, renameRepo, lockService, notificationService } = makeService();
    renameRepo.findBookRenameData.mockResolvedValue(
      makeRenameData({
        file: {
          absolutePath: '/library/Old Title.epub',
          relPath: 'Old Title.epub',
        },
        bookFolderPath: '/library/Old Title.epub',
      }),
    );

    const result = await service.performRename(5, 12);

    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        oldPath: '/library/Old Title.epub',
        newPath: '/library/Frank Herbert/Dune.epub',
      }),
    );
    expect(renameRepo.applyFileRename).toHaveBeenCalledWith(
      5,
      10,
      '/library/Frank Herbert/Dune.epub',
      'Frank Herbert/Dune.epub',
      '/library/Frank Herbert/Dune.epub',
    );
    expect(renameRepo.applyFileRename.mock.invocationCallOrder[0]).toBeLessThan(mockRename.mock.invocationCallOrder[0]);
    expect(mockMkdir).toHaveBeenCalledWith('/library/Frank Herbert', { recursive: true });
    expect(lockService.withLock).toHaveBeenCalledWith('/library/Old Title.epub', expect.any(Function));
    expect(mockRename).toHaveBeenCalledWith('/library/Old Title.epub', '/library/Frank Herbert/Dune.epub');
    expect(notificationService.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.FileRenameCompleted,
        meta: {
          bookId: 5,
          oldPath: '/library/Old Title.epub',
          newPath: '/library/Frank Herbert/Dune.epub',
        },
      }),
    );
  });

  it('renames the folder, primary file, and companion files in book-per-folder mode', async () => {
    const { service, renameRepo, lockService } = makeService();
    renameRepo.findBookRenameData.mockResolvedValue(
      makeRenameData({
        organizationMode: 'book_per_folder',
        fileNamingPattern: '{authors}/{title}/{title}',
        file: {
          absolutePath: '/library/old-folder/Old Title.epub',
          relPath: 'old-folder/Old Title.epub',
        },
        bookFolderPath: '/library/old-folder',
      }),
    );
    renameRepo.findAllBookFiles.mockResolvedValue([
      {
        id: 10,
        absolutePath: '/library/old-folder/Old Title.epub',
        relPath: 'old-folder/Old Title.epub',
        role: 'primary',
      },
      {
        id: 11,
        absolutePath: '/library/old-folder/cover.jpg',
        relPath: 'old-folder/cover.jpg',
        role: 'cover',
      },
    ]);

    const result = await service.performRename(5, 12);

    expect(result).toEqual(
      expect.objectContaining({
        status: 'success',
        oldPath: '/library/old-folder/Old Title.epub',
        newPath: '/library/Frank Herbert/Dune/Dune.epub',
      }),
    );
    expect(renameRepo.applyFolderRename).toHaveBeenCalledWith(
      5,
      [
        {
          id: 10,
          absolutePath: '/library/Frank Herbert/Dune/Dune.epub',
          relPath: 'Frank Herbert/Dune/Dune.epub',
        },
        {
          id: 11,
          absolutePath: '/library/Frank Herbert/Dune/cover.jpg',
          relPath: 'Frank Herbert/Dune/cover.jpg',
        },
      ],
      '/library/Frank Herbert/Dune',
    );
    expect(mockRename).toHaveBeenNthCalledWith(1, '/library/old-folder', '/library/Frank Herbert/Dune');
    expect(mockRename).toHaveBeenNthCalledWith(2, '/library/Frank Herbert/Dune/Old Title.epub', '/library/Frank Herbert/Dune/Dune.epub');
    expect(lockService.withLock).toHaveBeenNthCalledWith(1, '/library/old-folder', expect.any(Function));
    expect(lockService.withLock).toHaveBeenNthCalledWith(2, '/library/Frank Herbert/Dune/Old Title.epub', expect.any(Function));
  });

  it('rolls back database paths and reports failure when the filesystem rename fails', async () => {
    const { service, renameRepo, notificationService } = makeService();
    renameRepo.findBookRenameData.mockResolvedValue(
      makeRenameData({
        file: {
          absolutePath: '/library/Old Title.epub',
          relPath: 'Old Title.epub',
        },
        bookFolderPath: '/library/Old Title.epub',
      }),
    );
    mockRename.mockRejectedValueOnce(new Error('rename blew up'));

    const result = await service.performRename(5, 12);

    expect(result).toEqual(
      expect.objectContaining({
        status: 'failed',
        reason: 'rename blew up',
        oldPath: '/library/Old Title.epub',
        newPath: '/library/Frank Herbert/Dune.epub',
      }),
    );
    expect(renameRepo.applyFileRename).toHaveBeenNthCalledWith(
      1,
      5,
      10,
      '/library/Frank Herbert/Dune.epub',
      'Frank Herbert/Dune.epub',
      '/library/Frank Herbert/Dune.epub',
    );
    expect(renameRepo.applyFileRename).toHaveBeenNthCalledWith(2, 5, 10, '/library/Old Title.epub', 'Old Title.epub', '/library/Old Title.epub');
    expect(notificationService.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.FileRenameFailed,
        message: 'rename blew up',
      }),
    );
  });

  it('skips when book data is not found', async () => {
    const { service, renameRepo, notificationService } = makeService();
    renameRepo.findBookRenameData.mockResolvedValue(null);

    const result = await service.performRename(99, 1);

    expect(result).toEqual(expect.objectContaining({ status: 'skipped', reason: 'book not found' }));
    expect(notificationService.notify).not.toHaveBeenCalled();
  });

  it('skips when computed path is identical to current path', async () => {
    const { service, renameRepo, notificationService } = makeService();
    renameRepo.findBookRenameData.mockResolvedValue(
      makeRenameData({
        file: {
          absolutePath: '/library/Frank Herbert/Dune.epub',
          relPath: 'Frank Herbert/Dune.epub',
        },
        bookFolderPath: '/library/Frank Herbert/Dune.epub',
      }),
    );

    const result = await service.performRename(5, 12);

    expect(result).toEqual(expect.objectContaining({ status: 'skipped', reason: 'path unchanged' }));
    expect(notificationService.notify).not.toHaveBeenCalled();
  });

  it('falls back to global upload pattern when library has no fileNamingPattern', async () => {
    const { service, renameRepo, appSettings } = makeService();
    renameRepo.findBookRenameData.mockResolvedValue(
      makeRenameData({
        fileNamingPattern: null,
        file: {
          absolutePath: '/library/Old Title.epub',
          relPath: 'Old Title.epub',
        },
        bookFolderPath: '/library/Old Title.epub',
      }),
    );

    await service.performRename(5, 12);

    expect(appSettings.getUploadPattern).toHaveBeenCalled();
    expect(mockRename).toHaveBeenCalledWith('/library/Old Title.epub', '/library/Frank Herbert/Dune.epub');
  });

  it('falls back to global book-per-folder pattern for book_per_folder libraries without fileNamingPattern', async () => {
    const { service, renameRepo, appSettings } = makeService();
    renameRepo.findBookRenameData.mockResolvedValue(
      makeRenameData({
        organizationMode: 'book_per_folder',
        fileNamingPattern: null,
        file: {
          absolutePath: '/library/old-folder/Old Title.epub',
          relPath: 'old-folder/Old Title.epub',
        },
        bookFolderPath: '/library/old-folder',
      }),
    );

    await service.performRename(5, 12);

    expect(appSettings.getUploadPatternBookPerFolder).toHaveBeenCalled();
  });

  it('skips and notifies when target path already exists on disk', async () => {
    const { service, renameRepo, notificationService } = makeService();
    renameRepo.findBookRenameData.mockResolvedValue(
      makeRenameData({
        file: {
          absolutePath: '/library/Old Title.epub',
          relPath: 'Old Title.epub',
        },
        bookFolderPath: '/library/Old Title.epub',
      }),
    );
    mockAccess.mockResolvedValue(undefined as never);

    const result = await service.performRename(5, 12);

    expect(result).toEqual(
      expect.objectContaining({
        status: 'skipped',
        reason: 'target path already exists on disk',
        oldPath: '/library/Old Title.epub',
        newPath: '/library/Frank Herbert/Dune.epub',
      }),
    );
    expect(notificationService.notify).toHaveBeenCalledWith(expect.objectContaining({ type: NotificationType.FileRenameFailed }));
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('renames only the file (not folder) in book_per_folder mode when folder path is unchanged', async () => {
    const { service, renameRepo } = makeService();
    // Pattern resolves to the same folder but a different filename
    renameRepo.findBookRenameData.mockResolvedValue(
      makeRenameData({
        organizationMode: 'book_per_folder',
        fileNamingPattern: 'same-folder/{title}',
        file: {
          absolutePath: '/library/same-folder/Old Title.epub',
          relPath: 'same-folder/Old Title.epub',
        },
        bookFolderPath: '/library/same-folder',
      }),
    );

    const result = await service.performRename(5, 12);

    expect(result).toEqual(expect.objectContaining({ status: 'success' }));
    expect(renameRepo.applyFileRename).toHaveBeenCalled();
    expect(renameRepo.applyFolderRename).not.toHaveBeenCalled();
    expect(mockRename).toHaveBeenCalledWith('/library/same-folder/Old Title.epub', '/library/same-folder/Dune.epub');
  });

  it('removes old empty directory after file-only rename moves to a new folder', async () => {
    const { service, renameRepo } = makeService();
    renameRepo.findBookRenameData.mockResolvedValue(
      makeRenameData({
        file: {
          absolutePath: '/library/Old Title.epub',
          relPath: 'Old Title.epub',
        },
        bookFolderPath: '/library/Old Title.epub',
      }),
    );
    mockReaddir.mockResolvedValue([] as never);

    await service.performRename(5, 12);

    expect(mockRmdir).toHaveBeenCalledWith('/library');
  });

  it('clears all timers on module destroy', () => {
    const { service } = makeService();
    service.scheduleRename(1, 10);
    service.scheduleRename(2, 10);
    expect(() => service.onModuleDestroy()).not.toThrow();
  });
});
