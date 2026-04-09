import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { FileWatcherService } from './file-watcher.service';
import { FileEventProcessorService } from './file-event-processor.service';
import { ScanGateway } from './scan.gateway';
import { ScannerService } from './scanner.service';

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
  } as unknown as ScanGateway;

  const scannerService = {
    startScanAsync: vi.fn(),
    scanBookFolderAsync: vi.fn(),
    isScanRunning: vi.fn().mockReturnValue(false),
  } as unknown as ScannerService;

  const service = new FileWatcherService(db, processor, gateway, scannerService);
  return { service, processor, gateway, scannerService };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// ── bootstrap resilience ─────────────────────────────────────────────────────

describe('onApplicationBootstrap()', () => {
  it('continues startup when a library watcher fails to bind', async () => {
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ id: 42 }]) }) })
        .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ path: '/books' }]) }) }),
    };
    const { service } = makeService(db);
    const startWatcher = vi.spyOn(service, 'startWatcher').mockRejectedValue(new Error('Bad file descriptor'));

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();

    expect(startWatcher).toHaveBeenCalledWith(42, ['/books']);
    await service.onModuleDestroy();
  });
});

// ── process() routing ─────────────────────────────────────────────────────────

describe('process()', () => {
  it('emits book-missing when handleUnlink returns book-missing', async () => {
    const { service, processor, gateway } = makeService();
    const missing = { type: 'book-missing', libraryId: 1, bookIds: [10, 11] };
    processor.handleUnlink = vi.fn().mockResolvedValue(missing);

    await (service as any).process('delete', '/books/Author/book.epub', 1);

    expect(gateway.emitBookMissing).toHaveBeenCalledWith({ libraryId: 1, bookIds: [10, 11] });
  });

  it('falls back to handleUnlinkDir when handleUnlink returns noop on delete', async () => {
    const { service, processor, gateway } = makeService();
    const missing = { type: 'book-missing', libraryId: 3, bookIds: [20] };
    processor.handleUnlink = vi.fn().mockResolvedValue({ type: 'noop' });
    processor.handleUnlinkDir = vi.fn().mockResolvedValue(missing);

    await (service as any).process('delete', '/books/Author', 3);

    expect(processor.handleUnlink).toHaveBeenCalledWith('/books/Author', 3);
    expect(processor.handleUnlinkDir).toHaveBeenCalledWith('/books/Author', 3);
    expect(gateway.emitBookMissing).toHaveBeenCalledWith({ libraryId: 3, bookIds: [20] });
  });

  it('emits book-restored when handleCreate returns book-restored', async () => {
    const { service, processor, gateway } = makeService();
    const restored = { type: 'book-restored', libraryId: 1, bookIds: [7] };
    processor.handleCreate = vi.fn().mockResolvedValue(restored);

    await (service as any).process('create', '/books/Author/book.epub', 1);

    expect(processor.handleCreate).toHaveBeenCalledWith('/books/Author/book.epub', 1);
    expect((gateway as any).emitBookRestored).toHaveBeenCalledWith({ libraryId: 1, bookIds: [7] });
    expect(gateway.emitBookMissing).not.toHaveBeenCalled();
  });

  it('schedules a folder scan when handleCreate returns noop (genuinely new file)', async () => {
    const { service, scannerService } = makeService();
    const scheduleFolderScanSpy = vi.spyOn(service as any, 'scheduleFolderScan');

    await (service as any).process('create', '/books/new.epub', 5);

    expect(scheduleFolderScanSpy).toHaveBeenCalledWith('/books/new.epub', 5);
    expect(scannerService.startScanAsync).not.toHaveBeenCalled();
  });

  it('starts a full scan when handleCreate noop targets a directory', async () => {
    const { service, scannerService } = makeService();
    const tempDir = await mkdtemp(join(tmpdir(), 'watcher-dir-create-'));

    try {
      await (service as any).process('create', tempDir, 8);
      expect(scannerService.startScanAsync).toHaveBeenCalledWith(8);
      expect(scannerService.scanBookFolderAsync).not.toHaveBeenCalled();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('suppresses folder scan for file creates under a recently created directory while full scan is running', async () => {
    const { service, scannerService } = makeService();
    const scheduleFolderScanSpy = vi.spyOn(service as any, 'scheduleFolderScan');
    const tempDir = await mkdtemp(join(tmpdir(), 'watcher-dir-suppress-'));
    const nestedFile = join(tempDir, 'book.epub');

    try {
      await (service as any).process('create', tempDir, 9);
      (scannerService.isScanRunning as vi.Mock).mockReturnValue(true);
      await (service as any).process('create', nestedFile, 9);

      expect(scannerService.startScanAsync).toHaveBeenCalledWith(9);
      expect(scheduleFolderScanSpy).not.toHaveBeenCalled();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('schedules a folder scan and emits book-moved when handleCreate returns book-moved', async () => {
    const { service, processor, gateway, scannerService } = makeService();
    const scheduleFolderScanSpy = vi.spyOn(service as any, 'scheduleFolderScan');
    processor.handleCreate = vi.fn().mockResolvedValue({ type: 'book-moved', libraryId: 1, bookIds: [5] });

    await (service as any).process('create', '/books/moved.epub', 1);

    expect((gateway as any).emitBookMoved).toHaveBeenCalledWith({ libraryId: 1, bookIds: [5] });
    expect(scheduleFolderScanSpy).toHaveBeenCalledWith('/books/moved.epub', 1);
    expect(scannerService.startScanAsync).not.toHaveBeenCalled();
  });

  it('emits nothing when both handlers return noop', async () => {
    const { service, gateway } = makeService();

    await (service as any).process('delete', '/nowhere/file.epub', 1);

    expect(gateway.emitBookMissing).not.toHaveBeenCalled();
  });
});

// ── schedule() debounce ───────────────────────────────────────────────────────

describe('schedule() debounce', () => {
  it('debounces rapid events for the same path — process called only once', async () => {
    const { service } = makeService();
    const processSpy = vi.spyOn(service as any, 'process').mockResolvedValue(undefined);

    (service as any).schedule('delete', '/books/file.epub', 1);
    (service as any).schedule('delete', '/books/file.epub', 1);
    (service as any).schedule('delete', '/books/file.epub', 1);

    vi.runAllTimers();
    await Promise.resolve();

    expect(processSpy).toHaveBeenCalledTimes(1);
    expect(processSpy).toHaveBeenCalledWith('delete', '/books/file.epub', 1);
  });

  it('last event type wins when delete and create race for the same path', async () => {
    const { service } = makeService();
    const processSpy = vi.spyOn(service as any, 'process').mockResolvedValue(undefined);

    (service as any).schedule('delete', '/books/file.epub', 1);
    (service as any).schedule('create', '/books/file.epub', 1); // overrides delete

    vi.runAllTimers();
    await Promise.resolve();

    expect(processSpy).toHaveBeenCalledTimes(1);
    expect(processSpy).toHaveBeenCalledWith('create', '/books/file.epub', 1);
  });

  it('does not debounce events for different paths', async () => {
    const { service } = makeService();
    const processSpy = vi.spyOn(service as any, 'process').mockResolvedValue(undefined);

    (service as any).schedule('delete', '/books/file-a.epub', 1);
    (service as any).schedule('delete', '/books/file-b.epub', 1);

    vi.runAllTimers();
    await Promise.resolve();

    expect(processSpy).toHaveBeenCalledTimes(2);
  });
});

// ── reconcile() ───────────────────────────────────────────────────────────────

describe('reconcile()', () => {
  it('emits book-restored for each restored result from reconcileMissingBooks', async () => {
    const { service, processor, gateway } = makeService();
    (service as any).subscriptions.set(1, []);
    (processor.reconcileMissingBooks as vi.Mock).mockResolvedValue([
      { type: 'book-restored', libraryId: 1, bookIds: [10, 11] },
      { type: 'book-restored', libraryId: 2, bookIds: [20] },
    ]);

    await (service as any).reconcile();

    expect(gateway.emitBookRestored).toHaveBeenCalledTimes(2);
    expect(gateway.emitBookRestored).toHaveBeenCalledWith({ libraryId: 1, bookIds: [10, 11] });
    expect(gateway.emitBookRestored).toHaveBeenCalledWith({ libraryId: 2, bookIds: [20] });
  });

  it('emits book-missing and book-moved for each result from reconcileMissingBooks', async () => {
    const { service, processor, gateway } = makeService();
    (service as any).subscriptions.set(1, []);
    (processor.reconcileMissingBooks as vi.Mock).mockResolvedValue([
      { type: 'book-missing', libraryId: 1, bookIds: [20] },
      { type: 'book-moved', libraryId: 1, bookIds: [30] },
    ]);

    await (service as any).reconcile();

    expect(gateway.emitBookMissing).toHaveBeenCalledWith({ libraryId: 1, bookIds: [20] });
    expect(gateway.emitBookMoved).toHaveBeenCalledWith({ libraryId: 1, bookIds: [30] });
  });

  it('does nothing when reconcileMissingBooks returns empty', async () => {
    const { service, gateway } = makeService();
    (service as any).subscriptions.set(1, []);

    await (service as any).reconcile();

    expect(gateway.emitBookRestored).not.toHaveBeenCalled();
  });

  it('does nothing when no libraries are being watched', async () => {
    const { service, processor, gateway } = makeService();

    await (service as any).reconcile();

    expect(processor.reconcileMissingBooks).not.toHaveBeenCalled();
    expect(gateway.emitBookRestored).not.toHaveBeenCalled();
  });
});

// ── scheduleFolderScan() debounce ─────────────────────────────────────────────

describe('scheduleFolderScan() debounce', () => {
  it('debounces multiple events for files in the same folder — scan triggered once', async () => {
    const { service, scannerService } = makeService();

    (service as any).scheduleFolderScan('/books/Author/Book/file1.epub', 1);
    (service as any).scheduleFolderScan('/books/Author/Book/file2.epub', 1);
    (service as any).scheduleFolderScan('/books/Author/Book/file3.epub', 1);

    vi.runAllTimers();
    await Promise.resolve();

    expect(scannerService.scanBookFolderAsync).toHaveBeenCalledTimes(1);
  });

  it('fires separate scans for files in different folders', async () => {
    const { service, scannerService } = makeService();

    (service as any).scheduleFolderScan('/books/Author/BookA/file.epub', 1);
    (service as any).scheduleFolderScan('/books/Author/BookB/file.epub', 1);

    vi.runAllTimers();
    await Promise.resolve();

    expect(scannerService.scanBookFolderAsync).toHaveBeenCalledTimes(2);
  });

  it('uses the last filePath when the same folder has multiple rapid events', async () => {
    const { service, scannerService } = makeService();

    (service as any).scheduleFolderScan('/books/Author/Book/first.epub', 1);
    (service as any).scheduleFolderScan('/books/Author/Book/last.epub', 1);

    vi.runAllTimers();
    await Promise.resolve();

    expect(scannerService.scanBookFolderAsync).toHaveBeenCalledWith('/books/Author/Book/last.epub', 1);
  });
});
