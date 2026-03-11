import { FileWatcherService } from './file-watcher.service';
import { FileEventProcessorService } from './file-event-processor.service';
import { ScanGateway } from './scan.gateway';
import { ScannerService } from './scanner.service';

function makeService() {
  const processor = {
    handleUnlink: jest.fn().mockResolvedValue({ type: 'noop' }),
    handleUnlinkDir: jest.fn().mockResolvedValue({ type: 'noop' }),
    handleCreate: jest.fn().mockResolvedValue({ type: 'noop' }),
    reconcileMissingBooks: jest.fn().mockResolvedValue([]),
  } as unknown as FileEventProcessorService;

  const gateway = {
    emitBookMissing: jest.fn(),
    emitBookRestored: jest.fn(),
  } as unknown as ScanGateway;

  const scannerService = {
    startScanAsync: jest.fn(),
  } as unknown as ScannerService;

  const db = {} as any;
  const service = new FileWatcherService(db, processor, gateway, scannerService);
  return { service, processor, gateway, scannerService };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

// ── process() routing ─────────────────────────────────────────────────────────

describe('process()', () => {
  it('emits book-missing when handleUnlink returns book-missing', async () => {
    const { service, processor, gateway } = makeService();
    const missing = { type: 'book-missing', libraryId: 1, bookIds: [10, 11] };
    processor.handleUnlink = jest.fn().mockResolvedValue(missing);

    await (service as any).process('delete', '/books/Author/book.epub', 1);

    expect(gateway.emitBookMissing).toHaveBeenCalledWith({ libraryId: 1, bookIds: [10, 11] });
  });

  it('falls back to handleUnlinkDir when handleUnlink returns noop on delete', async () => {
    const { service, processor, gateway } = makeService();
    const missing = { type: 'book-missing', libraryId: 3, bookIds: [20] };
    processor.handleUnlink = jest.fn().mockResolvedValue({ type: 'noop' });
    processor.handleUnlinkDir = jest.fn().mockResolvedValue(missing);

    await (service as any).process('delete', '/books/Author', 3);

    expect(processor.handleUnlink).toHaveBeenCalledWith('/books/Author');
    expect(processor.handleUnlinkDir).toHaveBeenCalledWith('/books/Author');
    expect(gateway.emitBookMissing).toHaveBeenCalledWith({ libraryId: 3, bookIds: [20] });
  });

  it('emits book-restored when handleCreate returns book-restored', async () => {
    const { service, processor, gateway } = makeService();
    const restored = { type: 'book-restored', libraryId: 1, bookIds: [7] };
    processor.handleCreate = jest.fn().mockResolvedValue(restored);

    await (service as any).process('create', '/books/Author/book.epub', 1);

    expect(processor.handleCreate).toHaveBeenCalledWith('/books/Author/book.epub');
    expect((gateway as any).emitBookRestored).toHaveBeenCalledWith({ libraryId: 1, bookIds: [7] });
    expect(gateway.emitBookMissing).not.toHaveBeenCalled();
  });

  it('schedules a scan when handleCreate returns noop (genuinely new file)', async () => {
    const { service, scannerService } = makeService();
    const scheduleScanSpy = jest.spyOn(service as any, 'scheduleScan');

    await (service as any).process('create', '/books/new.epub', 5);

    expect(scheduleScanSpy).toHaveBeenCalledWith(5);
    expect(scannerService.startScanAsync).not.toHaveBeenCalled(); // called after debounce, not immediately
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
    const processSpy = jest.spyOn(service as any, 'process').mockResolvedValue(undefined);

    (service as any).schedule('delete', '/books/file.epub', 1);
    (service as any).schedule('delete', '/books/file.epub', 1);
    (service as any).schedule('delete', '/books/file.epub', 1);

    jest.runAllTimers();
    await Promise.resolve();

    expect(processSpy).toHaveBeenCalledTimes(1);
    expect(processSpy).toHaveBeenCalledWith('delete', '/books/file.epub', 1);
  });

  it('last event type wins when delete and create race for the same path', async () => {
    const { service } = makeService();
    const processSpy = jest.spyOn(service as any, 'process').mockResolvedValue(undefined);

    (service as any).schedule('delete', '/books/file.epub', 1);
    (service as any).schedule('create', '/books/file.epub', 1); // overrides delete

    jest.runAllTimers();
    await Promise.resolve();

    expect(processSpy).toHaveBeenCalledTimes(1);
    expect(processSpy).toHaveBeenCalledWith('create', '/books/file.epub', 1);
  });

  it('does not debounce events for different paths', async () => {
    const { service } = makeService();
    const processSpy = jest.spyOn(service as any, 'process').mockResolvedValue(undefined);

    (service as any).schedule('delete', '/books/file-a.epub', 1);
    (service as any).schedule('delete', '/books/file-b.epub', 1);

    jest.runAllTimers();
    await Promise.resolve();

    expect(processSpy).toHaveBeenCalledTimes(2);
  });
});

// ── reconcile() ───────────────────────────────────────────────────────────────

describe('reconcile()', () => {
  it('emits book-restored for each restored result from reconcileMissingBooks', async () => {
    const { service, processor, gateway } = makeService();
    (service as any).subscriptions.set(1, []);
    (processor.reconcileMissingBooks as jest.Mock).mockResolvedValue([
      { type: 'book-restored', libraryId: 1, bookIds: [10, 11] },
      { type: 'book-restored', libraryId: 2, bookIds: [20] },
    ]);

    await (service as any).reconcile();

    expect(gateway.emitBookRestored).toHaveBeenCalledTimes(2);
    expect(gateway.emitBookRestored).toHaveBeenCalledWith({ libraryId: 1, bookIds: [10, 11] });
    expect(gateway.emitBookRestored).toHaveBeenCalledWith({ libraryId: 2, bookIds: [20] });
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
