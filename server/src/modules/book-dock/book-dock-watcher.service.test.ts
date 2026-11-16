vi.mock('../scanner/lib/classify', () => ({
  isPrimaryFormat: vi.fn(),
}));

vi.mock('../../common/utils/fs-stability.utils', () => ({
  waitForStability: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  readdir: vi.fn(),
  realpath: vi.fn().mockImplementation((p: string) => Promise.resolve(p)),
  // A path under the dock root is a loose file unless a test says otherwise, which is what
  // `isUnitDirectory` asks about.
  stat: vi.fn().mockResolvedValue({ isDirectory: () => false }),
  unlink: vi.fn(),
}));

vi.mock('chokidar', () => ({
  watch: vi.fn(),
}));

import { mkdir, readdir, realpath, stat, unlink } from 'fs/promises';
import { watch } from 'chokidar';

import { waitForStability } from '../../common/utils/fs-stability.utils';
import { isPrimaryFormat } from '../scanner/lib/classify';
import { BookDockWatcherService } from './book-dock-watcher.service';

function makeService(bookDockPath = '/data/book-dock') {
  const config = {
    get: vi.fn().mockImplementation((key: string) => (key === 'storage.bookDockPath' ? bookDockPath : undefined)),
  };
  const ingestService = {
    ingestFromWatchedFolder: vi.fn(),
    ingestUnitDirectory: vi.fn().mockResolvedValue({ created: 0, consumedDirectories: new Set() }),
  };
  const repo = {
    findByAbsolutePath: vi.fn(),
    findByUnitDirectory: vi.fn().mockResolvedValue(undefined),
    deleteById: vi.fn(),
    countsByStatus: vi.fn().mockResolvedValue({ pending: 1, ready: 2, error: 0, total: 3 }),
  };
  const gateway = {
    emitChanged: vi.fn(),
  };
  const processingState = {
    isPaused: vi.fn().mockResolvedValue(false),
  };
  const dockRegistry = {
    findEnabledByFolderName: vi.fn().mockResolvedValue(undefined),
  };
  const keptFiles = {
    forget: vi.fn().mockResolvedValue(undefined),
    prune: vi.fn().mockResolvedValue(0),
  };
  const service = new BookDockWatcherService(
    config as never,
    ingestService as never,
    repo as never,
    gateway as never,
    processingState as never,
    dockRegistry as never,
    keptFiles as never,
  );
  return { service, ingestService, repo, gateway, processingState, dockRegistry, keptFiles };
}

function makeReadyWatcher(overrides: { close?: ReturnType<typeof vi.fn> } = {}) {
  const watcher = {
    on: vi.fn().mockReturnThis(),
    once: vi.fn().mockImplementation((eventName: string, handler: () => void) => {
      if (eventName === 'ready') handler();
      return watcher;
    }),
    off: vi.fn().mockReturnThis(),
    close: overrides.close ?? vi.fn().mockResolvedValue(undefined),
  };
  return watcher;
}

describe('BookDockWatcherService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readdir).mockResolvedValue([]);
  });

  it('rescan walks files, forgets kept files that are gone, and emits summary', async () => {
    const { service, keptFiles } = makeService();
    const walkSpy = vi.spyOn(service as any, 'walkAndIngest').mockResolvedValue(undefined);
    const emitSpy = vi.spyOn(service as any, 'emitChange').mockReturnValue(undefined);

    await service.rescan();

    expect(walkSpy).toHaveBeenCalledWith('/data/book-dock');
    expect(keptFiles.prune).toHaveBeenCalledTimes(1);
    expect(walkSpy.mock.invocationCallOrder[0]).toBeLessThan(keptFiles.prune.mock.invocationCallOrder[0]!);
    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  it('rescan uses a custom configured Book Dock path', async () => {
    const { service } = makeService('/books/bookdrop');
    const walkSpy = vi.spyOn(service as any, 'walkAndIngest').mockResolvedValue(undefined);
    const emitSpy = vi.spyOn(service as any, 'emitChange').mockReturnValue(undefined);

    await service.rescan();

    expect(walkSpy).toHaveBeenCalledWith('/books/bookdrop');
    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  it('startWatcher ensures directory exists and subscribes for file events', async () => {
    const { service } = makeService();
    vi.mocked(watch).mockReturnValue(makeReadyWatcher() as never);

    await (service as any).startWatcher();

    expect(mkdir).toHaveBeenCalledWith('/data/book-dock', { recursive: true });
    expect(realpath).toHaveBeenCalledWith('/data/book-dock');
    expect(watch).toHaveBeenCalledWith('/data/book-dock', { ignoreInitial: true, followSymlinks: false, ignored: expect.any(Function) });
    const { ignored } = vi.mocked(watch).mock.calls[0]![1] as { ignored: (path: string) => boolean };
    expect(ignored('/data/book-dock')).toBe(false);
    expect(ignored('/data/book-dock/Dune.epub')).toBe(false);
    expect(ignored('/data/book-dock/._Dune.epub')).toBe(true);
    expect(ignored('/data/book-dock/#recycle/Dune.epub')).toBe(true);
  });

  it('process(create) ignores operating-system and NAS leftovers', async () => {
    const { service, ingestService } = makeService();
    vi.mocked(isPrimaryFormat).mockReturnValue(true);
    const scanSpy = vi.spyOn(service as any, 'scan');

    await (service as any).process('create', '/data/book-dock/._Dune.epub');
    await (service as any).process('create', '/data/book-dock/@eaDir/Dune.epub/SYNOFILE_THUMB_M.jpg');
    await (service as any).process('create', '/data/book-dock/.stversions/Dune~20261116.epub');

    expect(waitForStability).not.toHaveBeenCalled();
    expect(ingestService.ingestFromWatchedFolder).not.toHaveBeenCalled();
    expect(scanSpy).not.toHaveBeenCalled();
  });

  it('walkAndIngest never enters recycle bins or picks up AppleDouble files', async () => {
    const { service, ingestService } = makeService();
    vi.mocked(isPrimaryFormat).mockImplementation((path: string) => path.endsWith('.epub'));
    vi.mocked(readdir).mockImplementation((dir: string) => {
      if (dir === '/data/book-dock') {
        return Promise.resolve([
          { name: '#recycle', isDirectory: () => true, isFile: () => false },
          { name: '@eaDir', isDirectory: () => true, isFile: () => false },
          { name: '.Trash-1000', isDirectory: () => true, isFile: () => false },
          { name: '._Dune.epub', isDirectory: () => false, isFile: () => true },
          { name: 'Dune.epub', isDirectory: () => false, isFile: () => true },
        ] as any);
      }
      return Promise.resolve([] as any);
    });

    await (service as any).walkAndIngest('/data/book-dock');

    expect(ingestService.ingestFromWatchedFolder).toHaveBeenCalledTimes(1);
    expect(ingestService.ingestFromWatchedFolder).toHaveBeenCalledWith('/data/book-dock/Dune.epub', undefined);
    expect(ingestService.ingestUnitDirectory).not.toHaveBeenCalled();
  });

  it('startWatcher swallows watcher boot errors', async () => {
    const { service } = makeService();
    vi.mocked(watch).mockImplementation(() => {
      throw new Error('watch init failed');
    });

    await expect((service as any).startWatcher()).resolves.toBeUndefined();
  });

  it('process(create) waits for stability and ingests supported file types', async () => {
    const { service, ingestService, gateway } = makeService();
    vi.mocked(isPrimaryFormat).mockReturnValue(true);
    vi.mocked(waitForStability).mockResolvedValue(undefined);
    ingestService.ingestFromWatchedFolder.mockResolvedValue(42);

    await (service as any).process('create', '/data/book-dock/book.epub');

    expect(waitForStability).toHaveBeenCalledWith('/data/book-dock/book.epub');
    expect(ingestService.ingestFromWatchedFolder).toHaveBeenCalledWith('/data/book-dock/book.epub', undefined);
    expect(gateway.emitChanged).toHaveBeenCalledTimes(1);
  });

  it('rescan skips discovery while paused and emits current summary', async () => {
    const { service, processingState, ingestService, gateway } = makeService();
    const walkSpy = vi.spyOn(service as any, 'walkAndIngest').mockResolvedValue(undefined);
    processingState.isPaused.mockResolvedValue(true);

    await service.rescan();

    expect(walkSpy).not.toHaveBeenCalled();
    expect(ingestService.ingestFromWatchedFolder).not.toHaveBeenCalled();
    expect(gateway.emitChanged).toHaveBeenCalledTimes(1);
  });

  it('process(delete) removes db row and cover files before emitting summary', async () => {
    const { service, repo, gateway } = makeService();
    repo.findByAbsolutePath.mockResolvedValue({ id: 12, coverPath: '/data/book-dock/covers/12.jpg' });

    await (service as any).process('delete', '/data/book-dock/book.epub');

    expect(unlink).toHaveBeenCalledWith('/data/book-dock/covers/12.jpg');
    expect(unlink).toHaveBeenCalledWith('/data/book-dock/covers/12_thumb.jpg');
    expect(repo.deleteById).toHaveBeenCalledWith(12);
    expect(gateway.emitChanged).toHaveBeenCalledTimes(1);
  });

  it('process(delete) forgets a kept file or folder that was removed, with or without a row', async () => {
    const { service, repo, keptFiles } = makeService();
    repo.findByAbsolutePath.mockResolvedValue(undefined);

    await (service as any).process('delete', '/data/book-dock/_libraries/Fiction/Dune');

    expect(keptFiles.forget).toHaveBeenCalledWith('/data/book-dock/_libraries/Fiction/Dune');
    expect(repo.deleteById).not.toHaveBeenCalled();
  });

  it('process(create) skips stability and ingest while paused', async () => {
    const { service, ingestService, processingState } = makeService();
    processingState.isPaused.mockResolvedValue(true);
    vi.mocked(isPrimaryFormat).mockReturnValue(true);

    await (service as any).process('create', '/data/book-dock/book.epub');

    expect(waitForStability).not.toHaveBeenCalled();
    expect(ingestService.ingestFromWatchedFolder).not.toHaveBeenCalled();
  });

  /**
   * The recursion this replaced turned a dropped folder of 31 tracks into 31 independent rows,
   * each resolving its own destination from its own chapter-named tags.
   */
  it('walkAndIngest skips covers, ingests loose files, and hands folders over whole', async () => {
    const { service, ingestService } = makeService();
    vi.mocked(isPrimaryFormat).mockImplementation((path: string) => path.endsWith('.epub') || path.endsWith('.pdf'));
    vi.mocked(readdir).mockImplementation((dir: string) => {
      if (dir === '/data/book-dock') {
        return Promise.resolve([
          { name: 'covers', isDirectory: () => true, isFile: () => false },
          { name: 'nested', isDirectory: () => true, isFile: () => false },
          { name: 'root.epub', isDirectory: () => false, isFile: () => true },
        ] as any);
      }
      if (dir === '/data/book-dock/nested') {
        return Promise.resolve([
          { name: 'inner.pdf', isDirectory: () => false, isFile: () => true },
          { name: 'note.txt', isDirectory: () => false, isFile: () => true },
        ] as any);
      }
      return Promise.resolve([] as any);
    });

    await (service as any).walkAndIngest('/data/book-dock');

    expect(ingestService.ingestFromWatchedFolder).toHaveBeenCalledWith('/data/book-dock/root.epub', undefined);
    expect(ingestService.ingestFromWatchedFolder).not.toHaveBeenCalledWith('/data/book-dock/nested/inner.pdf');
    expect(ingestService.ingestUnitDirectory).toHaveBeenCalledWith('/data/book-dock/nested', undefined);
    expect(ingestService.ingestUnitDirectory).not.toHaveBeenCalledWith('/data/book-dock/covers');
  });

  it('leaves a directory alone once a unit row has claimed it', async () => {
    const { service, ingestService, repo } = makeService();
    repo.findByUnitDirectory.mockResolvedValue({ id: 4, autoFinalizeSuppressed: true });

    await (service as any).walkAndIngest('/data/book-dock/request-7-audiobook');

    expect(ingestService.ingestUnitDirectory).not.toHaveBeenCalled();
  });

  /** A dropped folder fires one `add` per file inside it, never a usable `addDir`. */
  it('routes a file event inside a folder to that folder as a unit', async () => {
    const { service, ingestService } = makeService();

    await (service as any).process('create', '/data/book-dock/Neuromancer/Chapter 3.mp3');

    expect(ingestService.ingestUnitDirectory).toHaveBeenCalledWith('/data/book-dock/Neuromancer', undefined);
    expect(ingestService.ingestFromWatchedFolder).not.toHaveBeenCalled();
  });

  /**
   * The other way a unit arrives: chokidar's `addDir` for the folder itself, which is a directory
   * one level below the root rather than a file. Only `stat` tells the two apart.
   */
  it('routes an event for the folder itself to the unit path', async () => {
    const { service, ingestService } = makeService();
    vi.mocked(stat).mockResolvedValueOnce({ isDirectory: () => true } as never);

    await (service as any).process('create', '/data/book-dock/Neuromancer');

    expect(stat).toHaveBeenCalledWith('/data/book-dock/Neuromancer');
    expect(ingestService.ingestUnitDirectory).toHaveBeenCalledWith('/data/book-dock/Neuromancer', undefined);
    expect(ingestService.ingestFromWatchedFolder).not.toHaveBeenCalled();
  });

  describe('library docks', () => {
    const fiction = { id: 3, libraryId: 14, targetFolderId: 22, enabled: true };

    it('files an event inside a dock folder under that dock', async () => {
      const { service, ingestService, dockRegistry } = makeService();
      dockRegistry.findEnabledByFolderName.mockResolvedValue(fiction);
      vi.mocked(isPrimaryFormat).mockReturnValue(true);
      ingestService.ingestFromWatchedFolder.mockResolvedValue(42);

      await (service as any).process('create', '/data/book-dock/_libraries/Fiction/Dune.epub');
      await (service as any).process('create', '/data/book-dock/_libraries/Fiction/Hyperion/CD 1/01.mp3');

      const arrival = { dockId: 3, libraryId: 14, folderId: 22 };
      expect(dockRegistry.findEnabledByFolderName).toHaveBeenCalledWith('Fiction');
      expect(ingestService.ingestFromWatchedFolder).toHaveBeenCalledWith('/data/book-dock/_libraries/Fiction/Dune.epub', arrival);
      expect(ingestService.ingestUnitDirectory).toHaveBeenCalledWith('/data/book-dock/_libraries/Fiction/Hyperion', arrival);
    });

    it('debounces a dropped folder inside a dock on that folder, not on the dock', () => {
      const { service } = makeService();
      expect((service as any).unitDirectoryFor('/data/book-dock/_libraries/Fiction/Hyperion/CD 1/01.mp3')).toBe(
        '/data/book-dock/_libraries/Fiction/Hyperion',
      );
      expect((service as any).unitDirectoryFor('/data/book-dock/_libraries/Fiction/Dune.epub')).toBeNull();
    });

    it('creates nothing for a folder no dock owns or a dock that is off, but tells clients', async () => {
      const { service, ingestService, gateway } = makeService();
      vi.mocked(isPrimaryFormat).mockReturnValue(true);

      await (service as any).process('create', '/data/book-dock/_libraries/Unknown/Dune.epub');
      await (service as any).process('create', '/data/book-dock/_libraries/stray.epub');

      expect(ingestService.ingestFromWatchedFolder).not.toHaveBeenCalled();
      expect(ingestService.ingestUnitDirectory).not.toHaveBeenCalled();
      expect(gateway.emitChanged).toHaveBeenCalledTimes(2);
    });

    it('never treats _libraries as a book of Unsorted', async () => {
      const { service, ingestService } = makeService();
      vi.mocked(readdir).mockImplementation((dir: string) => {
        if (dir === '/data/book-dock') return Promise.resolve([{ name: '_libraries', isDirectory: () => true, isFile: () => false }] as any);
        if (dir === '/data/book-dock/_libraries') {
          return Promise.resolve([
            { name: 'Unknown', isDirectory: () => true, isFile: () => false },
            { name: 'stray.epub', isDirectory: () => false, isFile: () => true },
          ] as any);
        }
        return Promise.resolve([] as any);
      });

      await (service as any).walkAndIngest('/data/book-dock');

      expect(ingestService.ingestUnitDirectory).not.toHaveBeenCalled();
      expect(ingestService.ingestFromWatchedFolder).not.toHaveBeenCalled();
    });

    it('keeps a _libraries folder an older version took in as a book in Unsorted, and warns once', async () => {
      const { service, ingestService, repo, dockRegistry } = makeService();
      const warn = vi.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
      repo.findByUnitDirectory.mockImplementation((dir: string) => Promise.resolve(dir === '/data/book-dock/_libraries' ? { id: 1 } : undefined));
      dockRegistry.findEnabledByFolderName.mockResolvedValue(fiction);

      await (service as any).process('create', '/data/book-dock/_libraries/Fiction/Dune.epub');
      await (service as any).process('create', '/data/book-dock/_libraries/Fiction/Dune.epub');

      expect(ingestService.ingestUnitDirectory).toHaveBeenCalledWith('/data/book-dock/_libraries', undefined);
      expect(dockRegistry.findEnabledByFolderName).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  it('onModuleDestroy clears timers and unsubscribes active watcher', async () => {
    const { service } = makeService();
    const close = vi.fn().mockResolvedValue(undefined);
    (service as any).subscription = { close };
    const timer = setTimeout(() => undefined, 1_000);
    (service as any).pendingTimers.set('/tmp/file.epub', { timer, type: 'create' });

    await service.onModuleDestroy();

    expect(close).toHaveBeenCalledTimes(1);
    expect((service as any).pendingTimers.size).toBe(0);
    expect((service as any).subscription).toBeNull();
  });
});
