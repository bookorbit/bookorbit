import { BadRequestException, ConflictException, ForbiddenException, HttpException, Logger, NotFoundException } from '@nestjs/common';
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { BookDockSettings } from '@bookorbit/types';

import type { LibraryDockRow, NewLibraryDockRow } from '../../db/schema';
import { LibraryLifecycleService } from '../library/library-lifecycle.service';
import { UploadValidatorService } from '../upload/upload-validator.service';
import { probeFiling } from './library-dock-fs';
import { LibraryDockRegistry } from './library-dock-registry.service';
import type { LibraryDockWithLibrary } from './library-dock.repository';
import { LibraryDockService } from './library-dock.service';

vi.mock('./library-dock-fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./library-dock-fs')>();
  return { ...actual, probeFiling: vi.fn(actual.probeFiling) };
});

interface Library {
  id: number;
  name: string;
  folders: { id: number; path: string }[];
}

interface FileRow {
  id: number;
  absolutePath: string;
  status: string;
  targetLibraryId: number | null;
  targetFolderId: number | null;
  dockId?: number | null;
}

const global: BookDockSettings = {
  bookDockPath: '/data/book-dock',
  autoFetchMetadata: true,
  autoFinalizeEnabled: false,
  autoFinalizeThreshold: 85,
  autoFinalizeLibraryId: null,
  autoFinalizeFolderId: null,
  autoFinalizeMetadataMode: 'safe_merge',
};

const user = { id: 1, isSuperuser: true } as never;

function codeOf(error: unknown): string | undefined {
  if (!(error instanceof HttpException)) return undefined;
  return (error.getResponse() as { errorCode?: string }).errorCode;
}

async function refusal(promise: Promise<unknown>): Promise<HttpException> {
  const error = await promise.then(
    () => null,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(HttpException);
  return error as HttpException;
}

describe('LibraryDockService', () => {
  let root: string;
  let libraries: Library[];
  let docks: LibraryDockRow[];
  let files: FileRow[];
  let legacyUnitDirectory: string | null;
  let nextDockId: number;
  let service: LibraryDockService;
  let registry: LibraryDockRegistry;
  let lifecycle: LibraryLifecycleService;
  const released: string[][] = [];

  const watcher = {
    holdPaths: vi.fn((paths: string[]) => () => {
      released.push(paths);
    }),
    scanFolder: vi.fn().mockResolvedValue(undefined),
  };
  const gateway = { emitChanged: vi.fn() };
  const finalize = { recheckAfterSettingsChange: vi.fn() };

  const dockRepo = {
    listAll: vi.fn(() =>
      Promise.resolve(
        docks.map((dock) => ({ ...dock, libraryName: libraries.find((l) => l.id === dock.libraryId)?.name ?? '' }) as LibraryDockWithLibrary),
      ),
    ),
    findByLibraryId: vi.fn((libraryId: number) => Promise.resolve(docks.find((dock) => dock.libraryId === libraryId))),
    findById: vi.fn((id: number) => Promise.resolve(docks.find((dock) => dock.id === id))),
    create: vi.fn((data: NewLibraryDockRow) => {
      if (docks.some((dock) => dock.libraryId === data.libraryId || dock.folderName.toLowerCase() === data.folderName.toLowerCase())) {
        return Promise.reject(Object.assign(new Error('duplicate key'), { code: '23505' }));
      }
      const row = {
        id: nextDockId++,
        enabled: true,
        targetFolderId: null,
        autoFetchMetadata: null,
        autoFinalizeEnabled: null,
        autoFinalizeThreshold: null,
        autoFinalizeMetadataMode: null,
        autoJoin: false,
        keepOriginal: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      } as LibraryDockRow;
      docks.push(row);
      return Promise.resolve(row);
    }),
    update: vi.fn((id: number, data: Partial<LibraryDockRow>) => {
      const dock = docks.find((candidate) => candidate.id === id)!;
      Object.assign(dock, data);
      return Promise.resolve(dock);
    }),
    renameFolder: vi.fn((id: number, folderName: string, from: string, to: string) => {
      docks.find((dock) => dock.id === id)!.folderName = folderName;
      return Promise.resolve(movePaths(from, to));
    }),
    movePaths: vi.fn((from: string, to: string) => Promise.resolve(movePaths(from, to))),
    listUploadTargets: vi.fn().mockResolvedValue([]),
  };

  const fileRepo = {
    countWorkingUnder: vi.fn((path: string) =>
      Promise.resolve(
        files.filter(
          (file) =>
            ['pending', 'extracting', 'fetching'].includes(file.status) && (file.absolutePath === path || file.absolutePath.startsWith(`${path}/`)),
        ).length,
      ),
    ),
    findByUnitDirectory: vi.fn((path: string) => Promise.resolve(path === legacyUnitDirectory ? { id: 99 } : undefined)),
    findIdsByTargetLibrary: vi.fn((libraryId: number) =>
      Promise.resolve(files.filter((file) => file.targetLibraryId === libraryId).map((file) => file.id)),
    ),
    findIdsByTargetFolders: vi.fn((ids: number[]) =>
      Promise.resolve(files.filter((file) => file.targetFolderId !== null && ids.includes(file.targetFolderId)).map((file) => file.id)),
    ),
    markFromDeletedLibrary: vi.fn().mockResolvedValue(undefined),
    holdForRemovedFolder: vi.fn().mockResolvedValue(undefined),
    fillMissingFolder: vi.fn((dockId: number, libraryId: number, folderId: number) => {
      const waiting = files.filter((file) => file.dockId === dockId && file.targetLibraryId === libraryId && file.targetFolderId === null);
      for (const file of waiting) file.targetFolderId = folderId;
      return Promise.resolve(waiting.length);
    }),
    findLibraryFormats: vi.fn((libraryId: number) =>
      Promise.resolve({ name: libraries.find((l) => l.id === libraryId)?.name ?? '', allowedFormats: [] }),
    ),
  };

  const libraryService = {
    verifyAccess: vi.fn().mockResolvedValue(undefined),
    findOne: vi.fn((id: number) => {
      const library = libraries.find((candidate) => candidate.id === id);
      return library ? Promise.resolve(library) : Promise.reject(new NotFoundException('Library not found'));
    }),
    findAll: vi.fn(() => Promise.resolve(libraries)),
    findAccessibleLibraryIds: vi.fn().mockResolvedValue([10, 20]),
  };

  function movePaths(from: string, to: string): number {
    let moved = 0;
    for (const file of files) {
      if (file.absolutePath === from || file.absolutePath.startsWith(`${from}/`)) {
        file.absolutePath = to + file.absolutePath.slice(from.length);
        moved++;
      }
    }
    return moved;
  }

  const libs = (...parts: string[]) => join(root, '_libraries', ...parts);

  async function put(path: string, content = 'book'): Promise<string> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
    return path;
  }

  async function listing(path: string): Promise<string[]> {
    return (await readdir(path)).sort();
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    root = await realpath(await mkdtemp(join(tmpdir(), 'library-dock-service-')));
    libraries = [
      {
        id: 10,
        name: 'Fiction',
        folders: [
          { id: 100, path: '/books/fiction' },
          { id: 101, path: '/books/fiction-2' },
        ],
      },
      { id: 20, name: 'Comics: Marvel', folders: [{ id: 200, path: '/books/comics' }] },
      { id: 30, name: 'Empty', folders: [] },
    ];
    docks = [];
    files = [];
    legacyUnitDirectory = null;
    nextDockId = 1;
    released.length = 0;
    const config = { get: (key: string) => (key === 'storage.bookDockPath' ? root : undefined) };
    registry = new LibraryDockRegistry(dockRepo as never);
    lifecycle = new LibraryLifecycleService();
    service = new LibraryDockService(
      config as never,
      dockRepo as never,
      fileRepo as never,
      registry,
      watcher as never,
      libraryService as never,
      { getBookDockSettings: () => Promise.resolve(global) } as never,
      lifecycle,
      gateway as never,
      finalize as never,
      new UploadValidatorService(),
    );
    service.onModuleInit();
  });

  afterEach(async () => {
    await chmod(root, 0o755).catch(() => undefined);
    await chmod(join(root, '_libraries'), 0o755).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });

  describe('turning a dock on', () => {
    it('creates the folder from the library name, files into its first folder, and scans it', async () => {
      const entry = await service.updateDock(user, 10, { enabled: true });

      expect(await listing(libs())).toEqual(['Fiction']);
      expect(entry.dock).toMatchObject({ libraryId: 10, folderName: 'Fiction', enabled: true, targetFolderId: 100 });
      expect(entry).toMatchObject({ folderPresent: true, suggestedFolderName: null });
      expect(await registry.findEnabledByFolderName('fiction')).toMatchObject({ libraryId: 10 });
      expect(watcher.scanFolder).toHaveBeenCalledWith(libs('Fiction'));
      expect(gateway.emitChanged).toHaveBeenCalled();
    });

    it('sanitises the library name and numbers a clash', async () => {
      docks.push({ id: 50, libraryId: 99, folderName: 'comics_ marvel', enabled: false } as LibraryDockRow);
      nextDockId = 51;
      const entry = await service.updateDock(user, 20, { enabled: true });
      expect(entry.dock?.folderName).toBe('Comics Marvel');

      libraries.push({ id: 40, name: 'Comics Marvel', folders: [] });
      expect((await service.updateDock(user, 40, { enabled: true })).dock?.folderName).toBe('Comics Marvel (2)');
    });

    it('waits for a folder when the library has none', async () => {
      const entry = await service.updateDock(user, 30, { enabled: true });
      expect(entry.dock?.targetFolderId).toBeNull();
    });

    it('takes a typed folder name only as it is, and only when no other dock has it', async () => {
      await expect(refusal(service.updateDock(user, 10, { enabled: true, folderName: 'Fic:tion' })).then(codeOf)).resolves.toBe(
        'LIBRARY_DOCK_FOLDER_NAME_INVALID',
      );
      await expect(refusal(service.updateDock(user, 10, { enabled: true, folderName: 'CON' })).then(codeOf)).resolves.toBe(
        'LIBRARY_DOCK_FOLDER_NAME_INVALID',
      );
      await service.updateDock(user, 20, { enabled: true, folderName: 'Drop Here' });
      await expect(refusal(service.updateDock(user, 10, { enabled: true, folderName: 'drop here' })).then(codeOf)).resolves.toBe(
        'LIBRARY_DOCK_FOLDER_NAME_TAKEN',
      );
      expect(docks).toHaveLength(1);
    });

    it('needs enabled: true to give a library a dock', async () => {
      const error = await refusal(service.updateDock(user, 10, { autoJoin: true }));
      expect(error).toBeInstanceOf(BadRequestException);
      expect(codeOf(error)).toBe('LIBRARY_DOCK_NOT_ENABLED');
      expect(docks).toHaveLength(0);
    });

    it('refuses a folder the library does not have', async () => {
      await expect(refusal(service.updateDock(user, 10, { enabled: true, targetFolderId: 200 })).then(codeOf)).resolves.toBe(
        'LIBRARY_DOCK_TARGET_FOLDER_INVALID',
      );
    });

    it('refuses while _libraries is a book an earlier version took in, creating nothing', async () => {
      await put(libs('old.epub'));
      legacyUnitDirectory = libs();
      const error = await refusal(service.updateDock(user, 10, { enabled: true }));
      expect(codeOf(error)).toBe('LIBRARY_DOCKS_FOLDER_IS_BOOK');
      expect(await listing(libs())).toEqual(['old.epub']);
      expect(docks).toHaveLength(0);
    });

    it.skipIf(process.getuid?.() === 0)('says when the server cannot create the folder, and saves nothing', async () => {
      await mkdir(libs());
      await chmod(libs(), 0o555);
      const error = await refusal(service.updateDock(user, 10, { enabled: true }));
      expect(error).toBeInstanceOf(ConflictException);
      expect(codeOf(error)).toBe('LIBRARY_DOCK_FOLDER_UNWRITABLE');
      expect(docks).toHaveLength(0);
    });

    it('uses a folder already sitting there under that name', async () => {
      await put(libs('Fiction', 'Dune.epub'));
      await service.updateDock(user, 10, { enabled: true });
      expect(await listing(libs('Fiction'))).toEqual(['Dune.epub']);
      expect(watcher.scanFolder).toHaveBeenCalledWith(libs('Fiction'));
    });
  });

  describe('changing a dock', () => {
    beforeEach(async () => {
      await service.updateDock(user, 10, { enabled: true });
      vi.clearAllMocks();
    });

    it('turns it off without touching its folder, rows or files', async () => {
      await put(libs('Fiction', 'Dune.epub'));
      const entry = await service.updateDock(user, 10, { enabled: false });
      expect(entry.dock?.enabled).toBe(false);
      expect(await listing(libs('Fiction'))).toEqual(['Dune.epub']);
      expect(await registry.findEnabledByFolderName('Fiction')).toBeUndefined();
      expect(watcher.scanFolder).not.toHaveBeenCalled();
    });

    it('brings the folder back and scans it when turned on again', async () => {
      await service.updateDock(user, 10, { enabled: false });
      await rm(libs('Fiction'), { recursive: true });
      await service.updateDock(user, 10, { enabled: true });
      expect(await listing(libs())).toEqual(['Fiction']);
      expect(watcher.scanFolder).toHaveBeenCalledWith(libs('Fiction'));
    });

    it('stores overrides, and null goes back to inheriting', async () => {
      let entry = await service.updateDock(user, 10, { autoFinalizeEnabled: true, autoFinalizeThreshold: 95, targetFolderId: 101 });
      expect(entry.dock?.overrides).toMatchObject({ autoFinalizeEnabled: true, autoFinalizeThreshold: 95 });
      expect(entry.effective).toMatchObject({ autoFinalizeEnabled: true, autoFinalizeThreshold: 95, autoFetchMetadata: true });
      expect(entry.dock?.targetFolderId).toBe(101);

      entry = await service.updateDock(user, 10, { autoFinalizeThreshold: null });
      expect(entry.dock?.overrides.autoFinalizeThreshold).toBeNull();
      expect(entry.effective.autoFinalizeThreshold).toBe(85);
      expect(finalize.recheckAfterSettingsChange).toHaveBeenLastCalledWith(entry.dock?.id);
    });

    it("gives the dock's files waiting on a folder the new one, and leaves files sent elsewhere alone", async () => {
      const dockId = (await registry.findByFolderName('Fiction'))!.id;
      files.push(
        { id: 1, absolutePath: libs('Fiction', 'Dune.epub'), status: 'ready', dockId, targetLibraryId: 10, targetFolderId: null },
        { id: 2, absolutePath: libs('Fiction', 'Emma.epub'), status: 'ready', dockId, targetLibraryId: 20, targetFolderId: null },
      );

      await service.updateDock(user, 10, { targetFolderId: 101 });

      expect(files.map((file) => file.targetFolderId)).toEqual([101, null]);
      expect(finalize.recheckAfterSettingsChange).toHaveBeenCalledWith(dockId);
    });

    it('checks nothing again when nothing about the dock changed', async () => {
      finalize.recheckAfterSettingsChange.mockClear();
      await service.updateDock(user, 10, {});
      expect(finalize.recheckAfterSettingsChange).not.toHaveBeenCalled();
    });
  });

  describe('renaming a dock folder', () => {
    beforeEach(async () => {
      await service.updateDock(user, 10, { enabled: true });
      await put(libs('Fiction', 'Dune.epub'));
      files.push({ id: 1, absolutePath: libs('Fiction', 'Dune.epub'), status: 'ready', targetLibraryId: 10, targetFolderId: 100 });
      vi.clearAllMocks();
    });

    it('moves the folder and its rows together while the watcher looks away', async () => {
      const entry = await service.updateDock(user, 10, { folderName: 'Novels' });

      expect(await listing(libs())).toEqual(['Novels']);
      expect(await listing(libs('Novels'))).toEqual(['Dune.epub']);
      expect(files[0].absolutePath).toBe(libs('Novels', 'Dune.epub'));
      expect(entry.dock?.folderName).toBe('Novels');
      expect(watcher.holdPaths).toHaveBeenCalledWith([libs('Fiction'), libs('Novels')]);
      expect(released).toEqual([[libs('Fiction'), libs('Novels')]]);
      expect(await registry.findByFolderName('Novels')).toMatchObject({ libraryId: 10 });
      expect(await registry.findByFolderName('Fiction')).toBeUndefined();
    });

    it('offers the name the library now has, and renames to it', async () => {
      libraries[0].name = 'Novels & Stories';
      const admin = await service.getAdmin(user);
      expect(admin.libraries.find((entry) => entry.libraryId === 10)?.suggestedFolderName).toBe('Novels & Stories');

      await service.renameFolder(user, 10);
      expect(await listing(libs())).toEqual(['Novels & Stories']);
    });

    it('waits while files in the dock are still being read', async () => {
      files[0].status = 'extracting';
      await expect(refusal(service.renameFolder(user, 10, 'Novels')).then(codeOf)).resolves.toBe('LIBRARY_DOCK_BUSY');
      expect(await listing(libs())).toEqual(['Fiction']);
    });

    it('puts the folder back when the rows cannot follow', async () => {
      dockRepo.renameFolder.mockRejectedValueOnce(new Error('connection lost'));
      await expect(service.renameFolder(user, 10, 'Novels')).rejects.toThrow('connection lost');
      expect(await listing(libs())).toEqual(['Fiction']);
      expect(await listing(libs('Fiction'))).toEqual(['Dune.epub']);
      expect(docks[0].folderName).toBe('Fiction');
      expect(released).toHaveLength(1);
    });

    it('never renames onto something already there', async () => {
      await mkdir(libs('Novels'));
      await expect(refusal(service.renameFolder(user, 10, 'Novels')).then(codeOf)).resolves.toBe('LIBRARY_DOCK_FOLDER_EXISTS');
      expect(await listing(libs('Fiction'))).toEqual(['Dune.epub']);
    });

    it('changes only the name when the folder is gone from disk', async () => {
      await rm(libs('Fiction'), { recursive: true });
      await service.renameFolder(user, 10, 'Novels');
      expect(docks[0].folderName).toBe('Novels');
      expect(await listing(libs())).toEqual(['Novels']);
      expect(dockRepo.renameFolder).not.toHaveBeenCalled();
    });

    it('needs a dock to rename', async () => {
      await expect(refusal(service.renameFolder(user, 20)).then(codeOf)).resolves.toBe('LIBRARY_DOCK_NOT_FOUND');
    });
  });

  describe('folders no dock owns', () => {
    it('adopts one under its own name and scans it', async () => {
      await put(libs('Old Fiction', 'Dune.epub'));
      const entry = await service.adoptFolder(user, 'Old Fiction', 10);

      expect(entry.dock).toMatchObject({ folderName: 'Old Fiction', enabled: true, targetFolderId: 100 });
      expect(watcher.scanFolder).toHaveBeenCalledWith(libs('Old Fiction'));
    });

    it('refuses to adopt a missing folder, a path, a folder a dock owns, or into a library that has a dock', async () => {
      await service.updateDock(user, 10, { enabled: true });
      await mkdir(libs('Spare'));
      await expect(refusal(service.adoptFolder(user, 'Nope', 20)).then(codeOf)).resolves.toBe('LIBRARY_DOCK_FOLDER_NOT_FOUND');
      await expect(refusal(service.adoptFolder(user, '../_libraries', 20)).then(codeOf)).resolves.toBe('LIBRARY_DOCK_FOLDER_NOT_FOUND');
      await expect(refusal(service.adoptFolder(user, 'Fiction', 20)).then(codeOf)).resolves.toBe('LIBRARY_DOCK_FOLDER_OWNED');
      await expect(refusal(service.adoptFolder(user, 'Spare', 10)).then(codeOf)).resolves.toBe('LIBRARY_DOCK_EXISTS');
    });

    it('moves everything into Unsorted under free names, never over a file, then removes the folder', async () => {
      await put(join(root, 'Dune.epub'), 'already in Unsorted');
      await put(libs('Old', 'Dune.epub'), 'from the folder');
      await put(libs('Old', 'Hyperion', 'Hyperion.epub'));
      await put(libs('Old', 'covers', 'a.epub'));
      await put(libs('Old', '.DS_Store'));
      files.push({ id: 1, absolutePath: libs('Old', 'Hyperion', 'Hyperion.epub'), status: 'ready', targetLibraryId: null, targetFolderId: null });

      const result = await service.moveFolderToUnsorted('Old');

      expect(result).toEqual({ moved: 3, folderRemoved: true });
      expect(await listing(root)).toEqual(['Dune (2).epub', 'Dune.epub', 'Hyperion', '_libraries', 'covers (2)']);
      expect(await readFile(join(root, 'Dune.epub'), 'utf8')).toBe('already in Unsorted');
      expect(await readFile(join(root, 'Dune (2).epub'), 'utf8')).toBe('from the folder');
      expect(files[0].absolutePath).toBe(join(root, 'Hyperion', 'Hyperion.epub'));
      expect(await listing(libs())).toEqual([]);
      expect(watcher.holdPaths).toHaveBeenCalledWith([root]);
      expect(released).toEqual([[root]]);
      expect(watcher.scanFolder).toHaveBeenCalledWith(root);
    });

    it('puts an entry back when its rows cannot follow, and reports how far it got', async () => {
      await put(libs('Old', 'a.epub'));
      dockRepo.movePaths.mockRejectedValueOnce(new Error('connection lost'));
      await expect(service.moveFolderToUnsorted('Old')).rejects.toThrow('connection lost');
      expect(await listing(libs('Old'))).toEqual(['a.epub']);
      expect(released).toHaveLength(1);
    });

    it('waits while files in the folder are still being read', async () => {
      await put(libs('Old', 'a.epub'));
      files.push({ id: 1, absolutePath: libs('Old', 'a.epub'), status: 'pending', targetLibraryId: null, targetFolderId: null });
      await expect(refusal(service.moveFolderToUnsorted('Old')).then(codeOf)).resolves.toBe('LIBRARY_DOCK_BUSY');
      expect(await listing(libs('Old'))).toEqual(['a.epub']);
    });

    it('removes a folder holding only clutter, and refuses one with anything else in it', async () => {
      await put(libs('Clutter', '.DS_Store'));
      await put(libs('Clutter', 'Thumbs.db'));
      await service.removeFolder('Clutter');
      expect(await listing(libs())).toEqual([]);

      await put(libs('Books', 'Dune.epub'));
      await put(libs('Books', '.DS_Store'));
      const error = await refusal(service.removeFolder('Books'));
      expect(codeOf(error)).toBe('LIBRARY_DOCK_FOLDER_NOT_EMPTY');
      expect((error.getResponse() as { errorMeta: unknown }).errorMeta).toEqual({ entries: 1 });
      expect(await listing(libs('Books'))).toEqual(['.DS_Store', 'Dune.epub']);
    });
  });

  describe('the admin view', () => {
    it('lists libraries with their docks, folders no dock owns with a matching library, and stray files', async () => {
      await service.updateDock(user, 10, { enabled: true });
      await mkdir(libs('Comics Marvel'));
      await mkdir(libs('Leftovers'));
      await mkdir(libs('@eaDir'));
      await put(libs('stray.epub'));
      await put(libs('.DS_Store'));

      const admin = await service.getAdmin(user);

      expect(admin.librariesPath).toBe(libs());
      expect(admin.libraries.map((entry) => [entry.libraryId, entry.dock?.folderName ?? null, entry.folderPresent])).toEqual([
        [10, 'Fiction', true],
        [20, null, false],
        [30, null, false],
      ]);
      expect(admin.libraries[1].effective).toMatchObject({ autoFetchMetadata: true, autoJoin: false, keepOriginal: false });
      expect(admin.unrecognisedFolders).toEqual([
        { name: 'Comics Marvel', matchesLibraryId: 20 },
        { name: 'Leftovers', matchesLibraryId: null },
      ]);
      expect(admin.strayFiles).toEqual(['stray.epub']);
      expect(admin.librariesFolderIsBook).toBe(false);
    });

    it('reports a dock whose folder is gone from disk', async () => {
      await service.updateDock(user, 10, { enabled: true });
      await rm(libs('Fiction'), { recursive: true });
      expect((await service.getAdmin(user)).libraries[0].folderPresent).toBe(false);
    });
  });

  describe('uploads into a dock (D26, D27)', () => {
    it('lists the turned-on docks in the libraries the user can see', async () => {
      const targets = [{ dockId: 1, libraryId: 10, libraryName: 'Fiction', allowedFormats: [] }];
      dockRepo.listUploadTargets.mockResolvedValueOnce(targets);

      await expect(service.listUploadTargets(user)).resolves.toEqual({ docks: targets });
      expect(dockRepo.listUploadTargets).toHaveBeenCalledWith([10, 20]);
    });

    it("lands an upload in the dock's folder, headed for its target folder", async () => {
      await service.updateDock(user, 10, { enabled: true, targetFolderId: 101 });

      await expect(service.resolveUploadDock(user, 10, 'Dune.epub')).resolves.toEqual({
        dockId: 1,
        libraryId: 10,
        folderId: 101,
        folderName: 'Fiction',
      });
      expect(libraryService.verifyAccess).toHaveBeenCalledWith(user, 10);
    });

    it('refuses a library the user cannot see before saying anything about its dock', async () => {
      await service.updateDock(user, 10, { enabled: true });
      libraryService.verifyAccess.mockRejectedValueOnce(new ForbiddenException('No access to this library'));

      await expect(service.resolveUploadDock(user, 10, 'Dune.epub')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses a library whose dock is off or missing', async () => {
      await service.updateDock(user, 10, { enabled: true });
      await service.updateDock(user, 10, { enabled: false });

      expect(codeOf(await refusal(service.resolveUploadDock(user, 10, 'Dune.epub')))).toBe('UPLOAD_TARGET_INVALID');
      expect(codeOf(await refusal(service.resolveUploadDock(user, 20, 'Dune.epub')))).toBe('UPLOAD_TARGET_INVALID');
    });

    it('refuses a format the library does not take, and one no library takes', async () => {
      await service.updateDock(user, 10, { enabled: true });
      const epubOnly = { name: 'Fiction', allowedFormats: ['epub'] };
      fileRepo.findLibraryFormats.mockResolvedValueOnce(epubOnly).mockResolvedValueOnce(epubOnly).mockResolvedValueOnce(epubOnly);

      expect(codeOf(await refusal(service.resolveUploadDock(user, 10, 'Dune.pdf')))).toBe('UPLOAD_FORMAT_NOT_ALLOWED');
      expect(codeOf(await refusal(service.resolveUploadDock(user, 10, 'notes.txt')))).toBe('UPLOAD_FORMAT_UNSUPPORTED');
      await expect(service.resolveUploadDock(user, 10, 'Dune.epub')).resolves.toMatchObject({ dockId: 1 });
    });

    it('refuses while _libraries is a book an earlier version took in', async () => {
      await service.updateDock(user, 10, { enabled: true });
      legacyUnitDirectory = libs();

      expect(codeOf(await refusal(service.resolveUploadDock(user, 10, 'Dune.epub')))).toBe('LIBRARY_DOCKS_FOLDER_IS_BOOK');
    });
  });

  describe('how filing reaches each library (D7)', () => {
    let shelves: string;

    beforeEach(async () => {
      shelves = await realpath(await mkdtemp(join(tmpdir(), 'library-dock-shelves-')));
      await mkdir(join(shelves, 'fiction'));
      libraries = [
        { id: 10, name: 'Fiction', folders: [{ id: 100, path: join(shelves, 'fiction') }] },
        { id: 20, name: 'Comics', folders: [{ id: 200, path: join(shelves, 'missing') }] },
        { id: 30, name: 'Empty', folders: [] },
      ];
    });

    afterEach(async () => {
      await rm(shelves, { recursive: true, force: true });
    });

    it('tries a rename from each dock, from _libraries for a library without one, and leaves nothing behind', async () => {
      await service.updateDock(user, 10, { enabled: true });

      const { checks } = await service.checkFiling(user);

      expect(checks).toEqual([
        { libraryId: 10, filing: 'move' },
        { libraryId: 20, filing: 'unknown', errorCode: 'ENOENT' },
        { libraryId: 30, filing: 'unknown' },
      ]);
      expect(vi.mocked(probeFiling).mock.calls).toEqual([
        [libs('Fiction'), join(shelves, 'fiction'), 'rename'],
        [libs(), join(shelves, 'missing'), 'rename'],
      ]);
      expect(await listing(libs('Fiction'))).toEqual([]);
      expect(await listing(join(shelves, 'fiction'))).toEqual([]);
    });

    it('tries a hardlink for a dock that keeps originals', async () => {
      await service.updateDock(user, 10, { enabled: true, keepOriginal: true });

      const { checks } = await service.checkFiling(user);

      expect(checks[0]).toEqual({ libraryId: 10, filing: 'move' });
      expect(vi.mocked(probeFiling)).toHaveBeenCalledWith(libs('Fiction'), join(shelves, 'fiction'), 'link');
    });
  });

  describe('library changes', () => {
    it('refuses library folders inside the Book Dock folder or around it, but not beside it', async () => {
      for (const path of [root, join(root, 'books'), dirname(root)]) {
        const error = await refusal(lifecycle.assertFolderPathsAllowed([path]));
        expect(codeOf(error)).toBe('LIBRARY_FOLDER_OVERLAPS_BOOK_DOCK');
        expect((error.getResponse() as { errorMeta: unknown }).errorMeta).toEqual({ path, overlapPath: root });
      }
      await expect(lifecycle.assertFolderPathsAllowed([`${root}-library`])).resolves.toBeUndefined();
    });

    it('moves the files of a deleted library to Unsorted once the delete went through', async () => {
      await service.updateDock(user, 10, { enabled: true });
      files.push({ id: 7, absolutePath: libs('Fiction', 'a.epub'), status: 'ready', targetLibraryId: 10, targetFolderId: 100 });
      files.push({ id: 8, absolutePath: join(root, 'b.epub'), status: 'ready', targetLibraryId: 20, targetFolderId: 200 });

      const followUp = await lifecycle.prepareLibraryDelete({ id: 10, name: 'Fiction' });
      expect(fileRepo.markFromDeletedLibrary).not.toHaveBeenCalled();
      docks.length = 0;
      vi.clearAllMocks();
      await followUp();

      expect(fileRepo.markFromDeletedLibrary).toHaveBeenCalledWith([7], 'Fiction');
      expect(await registry.findByFolderName('Fiction')).toBeUndefined();
      expect(gateway.emitChanged).toHaveBeenCalled();
    });

    it('holds files headed for a removed folder, and reloads the dock that filed into it', async () => {
      await service.updateDock(user, 10, { enabled: true });
      files.push({ id: 7, absolutePath: libs('Fiction', 'a.epub'), status: 'ready', targetLibraryId: 10, targetFolderId: 100 });
      const refresh = vi.spyOn(registry, 'refresh');

      const followUp = await lifecycle.prepareFoldersRemove(10, [100]);
      docks[0].targetFolderId = null;
      await followUp();

      expect(fileRepo.holdForRemovedFolder).toHaveBeenCalledWith([7], 10, 'Fiction');
      expect(refresh).toHaveBeenCalled();
      expect((await registry.findById(docks[0].id))?.targetFolderId).toBeNull();
    });
  });
});
