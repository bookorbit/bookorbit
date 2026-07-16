vi.mock('../scanner/lib/classify', () => ({
  isPrimaryFormat: vi.fn(),
}));

vi.mock('../scanner/lib/stability', () => ({
  waitForStability: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  readdir: vi.fn(),
  realpath: vi.fn().mockImplementation((p: string) => Promise.resolve(p)),
  unlink: vi.fn(),
}));

vi.mock('chokidar', () => ({
  watch: vi.fn(),
}));

import { mkdir, readdir, realpath, unlink } from 'fs/promises';
import { watch } from 'chokidar';

import { isPrimaryFormat } from '../scanner/lib/classify';
import { waitForStability } from '../scanner/lib/stability';
import { BookDockWatcherService } from './book-dock-watcher.service';

function makeService(bookDockPath = '/data/book-dock') {
  const config = {
    get: vi.fn().mockImplementation((key: string) => (key === 'storage.bookDockPath' ? bookDockPath : undefined)),
  };
  const ingestService = {
    ingestFromWatchedFolder: vi.fn(),
  };
  const repo = {
    findByAbsolutePath: vi.fn(),
    deleteById: vi.fn(),
    countsByStatus: vi.fn().mockResolvedValue({ pending: 1, ready: 2, error: 0, total: 3 }),
  };
  const gateway = {
    emitSummary: vi.fn(),
  };
  const processingState = {
    isPaused: vi.fn().mockResolvedValue(false),
  };
  const service = new BookDockWatcherService(config as never, ingestService as never, repo as never, gateway as never, processingState as never);
  return { service, ingestService, repo, gateway, processingState };
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
  });

  it('rescan walks files and emits summary', async () => {
    const { service } = makeService();
    const walkSpy = vi.spyOn(service as any, 'walkAndIngest').mockResolvedValue(undefined);
    const emitSpy = vi.spyOn(service as any, 'emitSummary').mockResolvedValue(undefined);

    await service.rescan();

    expect(walkSpy).toHaveBeenCalledWith('/data/book-dock');
    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  it('rescan uses a custom configured Book Dock path', async () => {
    const { service } = makeService('/books/bookdrop');
    const walkSpy = vi.spyOn(service as any, 'walkAndIngest').mockResolvedValue(undefined);
    const emitSpy = vi.spyOn(service as any, 'emitSummary').mockResolvedValue(undefined);

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
    expect(watch).toHaveBeenCalledWith('/data/book-dock', { ignoreInitial: true });
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
    expect(ingestService.ingestFromWatchedFolder).toHaveBeenCalledWith('/data/book-dock/book.epub');
    expect(gateway.emitSummary).toHaveBeenCalledWith({ pending: 1, ready: 2, error: 0, total: 3, paused: false });
  });

  it('rescan skips discovery while paused and emits current summary', async () => {
    const { service, processingState, ingestService, gateway } = makeService();
    const walkSpy = vi.spyOn(service as any, 'walkAndIngest').mockResolvedValue(undefined);
    processingState.isPaused.mockResolvedValue(true);

    await service.rescan();

    expect(walkSpy).not.toHaveBeenCalled();
    expect(ingestService.ingestFromWatchedFolder).not.toHaveBeenCalled();
    expect(gateway.emitSummary).toHaveBeenCalledWith({ pending: 1, ready: 2, error: 0, total: 3, paused: true });
  });

  it('process(delete) removes db row and cover files before emitting summary', async () => {
    const { service, repo, gateway } = makeService();
    repo.findByAbsolutePath.mockResolvedValue({ id: 12, coverPath: '/data/book-dock/covers/12.jpg' });

    await (service as any).process('delete', '/data/book-dock/book.epub');

    expect(unlink).toHaveBeenCalledWith('/data/book-dock/covers/12.jpg');
    expect(unlink).toHaveBeenCalledWith('/data/book-dock/covers/12_thumb.jpg');
    expect(repo.deleteById).toHaveBeenCalledWith(12);
    expect(gateway.emitSummary).toHaveBeenCalledWith({ pending: 1, ready: 2, error: 0, total: 3, paused: false });
  });

  it('process(create) skips stability and ingest while paused', async () => {
    const { service, ingestService, processingState } = makeService();
    processingState.isPaused.mockResolvedValue(true);
    vi.mocked(isPrimaryFormat).mockReturnValue(true);

    await (service as any).process('create', '/data/book-dock/book.epub');

    expect(waitForStability).not.toHaveBeenCalled();
    expect(ingestService.ingestFromWatchedFolder).not.toHaveBeenCalled();
  });

  it('walkAndIngest skips covers folder and ingests supported files recursively', async () => {
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

    expect(ingestService.ingestFromWatchedFolder).toHaveBeenCalledWith('/data/book-dock/root.epub');
    expect(ingestService.ingestFromWatchedFolder).toHaveBeenCalledWith('/data/book-dock/nested/inner.pdf');
    expect(ingestService.ingestFromWatchedFolder).not.toHaveBeenCalledWith('/data/book-dock/nested/note.txt');
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
