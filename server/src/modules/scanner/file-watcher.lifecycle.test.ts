vi.mock('chokidar', () => ({
  watch: vi.fn(),
}));

import { Logger } from '@nestjs/common';
import type { MockedFunction } from 'vitest';
import { watch } from 'chokidar';
import { SelfWriteRegistry } from '../../common/services/self-write-registry.service';

import { FileEventProcessorService } from './file-event-processor.service';
import { FileWatcherService } from './file-watcher.service';
import { ScanGateway } from './scan.gateway';
import { ScannerService } from './scanner.service';

const mockWatch = watch as MockedFunction<typeof watch>;

function makeService(db: any = {}) {
  const processor = {
    handleUnlink: vi.fn().mockResolvedValue({ type: 'noop' }),
    handleUnlinkDir: vi.fn().mockResolvedValue({ type: 'noop' }),
    handleCreate: vi.fn().mockResolvedValue({ type: 'noop' }),
    reconcileMissingBooks: vi.fn().mockResolvedValue([]),
  } as unknown as FileEventProcessorService;

  const gateway = {
    emitBookMissing: vi.fn(),
    emitBookRestored: vi.fn(),
    emitBookMoved: vi.fn(),
    emitBookTransferred: vi.fn(),
  } as unknown as ScanGateway;

  const scannerService = {
    startScanAsync: vi.fn(),
    scanBookFolderAsync: vi.fn(),
    scanBookDirectoryAsync: vi.fn(),
    isScanRunning: vi.fn().mockReturnValue(false),
    bufferBookMissingEvent: vi.fn(),
    bufferBooksUnavailableNotification: vi.fn(),
    bufferBooksRestoredNotification: vi.fn(),
  } as unknown as ScannerService;

  const service = new FileWatcherService(db, processor, gateway, scannerService, new SelfWriteRegistry());
  return { service, processor, gateway, scannerService };
}

function makeBootstrapDb(watchedLibraries: Array<{ id: number }> = []): any {
  const select = vi.fn();
  select.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(watchedLibraries),
    }),
  });

  for (let i = 0; i < watchedLibraries.length; i++) {
    select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ path: '/books' }]),
      }),
    });
  }

  return { select };
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

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  mockWatch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('FileWatcherService lifecycle and watcher controls', () => {
  it('fails bootstrap when watched-library query throws', async () => {
    const { service } = makeService({
      select: vi.fn(() => {
        throw new Error('db unavailable');
      }),
    });

    await expect(service.onApplicationBootstrap()).rejects.toThrow('db unavailable');
  });

  it('logs interval reconcile failures from the background timer', async () => {
    const { service, processor } = makeService(makeBootstrapDb());
    (service as any).subscriptions.set(1, []);
    (processor.reconcileMissingBooks as vi.Mock).mockRejectedValue(new Error('reconcile exploded'));

    await service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1_000);

    expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining('[scanner.watcher.reconcile] [fail]'));
    await service.onModuleDestroy();
  });

  it('starts no watcher subscriptions when no library paths are configured', async () => {
    const { service } = makeService();

    await expect(service.startWatcher(7, [])).resolves.toBeUndefined();
    expect(mockWatch).not.toHaveBeenCalled();
  });

  it('subscribes to paths and normalizes create/update/delete events', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const allHandlers: Array<(eventName: string, path: string) => void> = [];
    mockWatch.mockImplementation(() => {
      const watcher = makeReadyWatcher({ close });
      watcher.on.mockImplementation((eventName: string, handler: (...args: any[]) => void) => {
        if (eventName === 'all') allHandlers.push(handler as (eventName: string, path: string) => void);
        return watcher;
      });
      return watcher as any;
    });

    const { service } = makeService();
    const scheduleSpy = vi.spyOn(service as any, 'schedule').mockImplementation(() => undefined);

    await service.startWatcher(2, ['/books']);
    allHandlers[0]('add', '/books/new.epub');
    allHandlers[0]('change', '/books/edit.epub');
    allHandlers[0]('unlink', '/books/gone.epub');
    allHandlers[0]('raw', '/books/ignored.epub');

    expect(scheduleSpy).toHaveBeenNthCalledWith(1, 'create', '/books/new.epub', 2);
    expect(scheduleSpy).toHaveBeenNthCalledWith(2, 'create', '/books/edit.epub', 2);
    expect(scheduleSpy).toHaveBeenNthCalledWith(3, 'delete', '/books/gone.epub', 2);
    expect(scheduleSpy).toHaveBeenCalledTimes(3);
    expect(close).not.toHaveBeenCalled();
  });

  it('cleans up partially started watchers when one path subscription fails', async () => {
    const firstClose = vi.fn().mockResolvedValue(undefined);
    mockWatch.mockReturnValueOnce(makeReadyWatcher({ close: firstClose }) as any).mockImplementationOnce(() => {
      throw new Error('permission denied');
    });

    const { service } = makeService();

    await expect(service.startWatcher(3, ['/books/ok', '/books/fail'])).rejects.toThrow('permission denied');
    expect(firstClose).toHaveBeenCalledTimes(1);
  });

  it('returns immediately when stopping a library without an active watcher', async () => {
    const { service } = makeService();

    await expect(service.stopWatcher(999)).resolves.toBeUndefined();
  });

  it('stops active watchers and clears pending timers scoped to the library', async () => {
    const { service } = makeService();
    const close = vi.fn().mockResolvedValue(undefined);
    (service as any).subscriptions.set(11, [{ close }]);

    const timerA = setTimeout(() => undefined, 1000);
    const timerB = setTimeout(() => undefined, 1000);
    (service as any).pendingTimers.set('/books/a', { timer: timerA, type: 'create', libraryId: 11 });
    (service as any).pendingTimers.set('/books/b', { timer: timerB, type: 'create', libraryId: 99 });

    const folderTimerA = setTimeout(() => undefined, 1000);
    const folderTimerB = setTimeout(() => undefined, 1000);
    (service as any).pendingFolderScanTimers.set('/books/a', { timer: folderTimerA, libraryId: 11 });
    (service as any).pendingFolderScanTimers.set('/books/b', { timer: folderTimerB, libraryId: 99 });

    const rescanTimer = setTimeout(() => undefined, 1000);
    (service as any).pendingCrossLibraryReconcileTimer = rescanTimer;
    (service as any).pendingCrossLibraryReconcileLibraryIds.add(11);
    (service as any).pendingCrossLibraryReconcileLibraryIds.add(99);
    (service as any).watchedLibraryPaths.set(11, ['/books/a']);
    (service as any).watchedLibraryPaths.set(99, ['/books/b']);

    const suppressionTimerA = setTimeout(() => undefined, 1000);
    const suppressionTimerB = setTimeout(() => undefined, 1000);
    (service as any).suppressedDirScans.set(11, new Set(['/books/new']));
    (service as any).suppressedDirScanTimers.set('11:/books/new', suppressionTimerA);
    (service as any).suppressedDirScanTimers.set('12:/books/other', suppressionTimerB);

    await service.stopWatcher(11);

    expect(close).toHaveBeenCalledTimes(1);
    expect((service as any).pendingTimers.has('/books/a')).toBe(false);
    expect((service as any).pendingTimers.has('/books/b')).toBe(true);
    expect((service as any).pendingFolderScanTimers.has('/books/a')).toBe(false);
    expect((service as any).pendingFolderScanTimers.has('/books/b')).toBe(true);
    expect((service as any).pendingCrossLibraryReconcileLibraryIds.has(11)).toBe(false);
    expect((service as any).pendingCrossLibraryReconcileLibraryIds.has(99)).toBe(true);
    expect((service as any).watchedLibraryPaths.has(11)).toBe(false);
    expect((service as any).watchedLibraryPaths.has(99)).toBe(true);
    expect((service as any).suppressedDirScans.has(11)).toBe(false);
    expect((service as any).suppressedDirScanTimers.has('11:/books/new')).toBe(false);
    expect((service as any).suppressedDirScanTimers.has('12:/books/other')).toBe(true);
  });

  it('throws when stopWatcher cannot close an active subscription', async () => {
    const { service } = makeService();
    (service as any).subscriptions.set(12, [
      {
        close: vi.fn().mockRejectedValue(new Error('close failed')),
      },
    ]);

    await expect(service.stopWatcher(12)).rejects.toThrow('close failed');
  });

  it('clears all subscriptions during module destroy and propagates close failures', async () => {
    const { service } = makeService();
    const ok = vi.fn().mockResolvedValue(undefined);
    const bad = vi.fn().mockRejectedValue(new Error('destroy failed'));
    (service as any).subscriptions.set(1, [{ close: ok }]);

    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    expect(ok).toHaveBeenCalledTimes(1);

    (service as any).subscriptions.set(2, [{ close: bad }]);
    await expect(service.onModuleDestroy()).rejects.toThrow('destroy failed');
  });

  it('reconcile surfaces processor errors when watched libraries exist', async () => {
    const { service, processor } = makeService();
    (service as any).subscriptions.set(5, []);
    (processor.reconcileMissingBooks as vi.Mock).mockRejectedValue(new Error('broken reconcile'));

    await expect((service as any).reconcile()).rejects.toThrow('broken reconcile');
  });

  it('debounces cross-library reconciles across all watched libraries', () => {
    const { service, processor } = makeService();
    (service as any).subscriptions.set(1, []);
    (service as any).subscriptions.set(2, []);
    (service as any).subscriptions.set(3, []);

    (service as any).scheduleCrossLibraryReconcile();
    (service as any).scheduleCrossLibraryReconcile();

    vi.advanceTimersByTime(1_500);
    expect(processor.reconcileMissingBooks).toHaveBeenCalledWith([1, 2, 3]);
    expect(processor.reconcileMissingBooks).toHaveBeenCalledTimes(1);
  });

  it('suppresses folder scans temporarily for newly created directories', () => {
    const { service } = makeService();

    (service as any).suppressFolderScansForDir('/books/new', 4);
    expect((service as any).isFolderScanSuppressed('/books/new/chapter.epub', 4)).toBe(true);

    vi.advanceTimersByTime(6_000);
    expect((service as any).isFolderScanSuppressed('/books/new/chapter.epub', 4)).toBe(false);
    expect((service as any).isFolderScanSuppressed('/books/other/chapter.epub', 4)).toBe(false);
  });

  it('logs errors when debounced process execution fails', async () => {
    const { service } = makeService();
    (service as any).subscriptions.set(2, []);
    vi.spyOn(service as any, 'process').mockRejectedValue(new Error('process failed'));

    (service as any).schedule('delete', '/books/fail.epub', 2);
    vi.runAllTimers();
    await Promise.resolve();

    expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining('[scanner.watcher.process_event] [fail]'));
  });
});
