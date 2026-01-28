import { FileWatcherService } from './file-watcher.service';
import { FileEventProcessorService } from './file-event-processor.service';
import { ScanGateway } from './scan.gateway';

function makeService(processorResult: any = { type: 'noop' }) {
  const processor = {
    handleUnlink: jest.fn().mockResolvedValue(processorResult),
    handleUnlinkDir: jest.fn().mockResolvedValue(processorResult),
  } as unknown as FileEventProcessorService;

  const gateway = {
    emitBookMissing: jest.fn(),
    emitBookFileRemoved: jest.fn(),
  } as unknown as ScanGateway;

  // DB stub — onApplicationBootstrap queries libraries; tests don't call it so db is unused
  const db = {} as any;

  const service = new FileWatcherService(db, processor, gateway);
  return { service, processor, gateway };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

// ── process() routing ─────────────────────────────────────────────────────────

describe('process()', () => {
  it('calls emitBookMissing when processor returns book-missing', async () => {
    const missing = { type: 'book-missing', libraryId: 1, bookIds: [10, 11] };
    const { service, processor, gateway } = makeService(missing);
    processor.handleUnlink = jest.fn().mockResolvedValue(missing);

    await (service as any).process('unlink', '/books/Author/book.epub');

    expect(gateway.emitBookMissing).toHaveBeenCalledWith({ libraryId: 1, bookIds: [10, 11] });
    expect(gateway.emitBookFileRemoved).not.toHaveBeenCalled();
  });

  it('calls emitBookFileRemoved when processor returns file-removed', async () => {
    const removed = { type: 'file-removed', libraryId: 2, bookId: 5, fileId: 99 };
    const { service, processor, gateway } = makeService(removed);
    processor.handleUnlink = jest.fn().mockResolvedValue(removed);

    await (service as any).process('unlink', '/books/Author/book.pdf');

    expect(gateway.emitBookFileRemoved).toHaveBeenCalledWith({ libraryId: 2, bookId: 5, fileId: 99 });
    expect(gateway.emitBookMissing).not.toHaveBeenCalled();
  });

  it('calls neither gateway method when processor returns noop', async () => {
    const { service, processor, gateway } = makeService({ type: 'noop' });
    processor.handleUnlink = jest.fn().mockResolvedValue({ type: 'noop' });

    await (service as any).process('unlink', '/nowhere/file.epub');

    expect(gateway.emitBookMissing).not.toHaveBeenCalled();
    expect(gateway.emitBookFileRemoved).not.toHaveBeenCalled();
  });

  it('delegates unlinkDir to processor.handleUnlinkDir', async () => {
    const missing = { type: 'book-missing', libraryId: 3, bookIds: [20] };
    const { service, processor, gateway } = makeService(missing);
    processor.handleUnlinkDir = jest.fn().mockResolvedValue(missing);

    await (service as any).process('unlinkDir', '/books/Author');

    expect(processor.handleUnlinkDir).toHaveBeenCalledWith('/books/Author');
    expect(processor.handleUnlink).not.toHaveBeenCalled();
    expect(gateway.emitBookMissing).toHaveBeenCalledWith({ libraryId: 3, bookIds: [20] });
  });
});

// ── schedule() debounce ───────────────────────────────────────────────────────

describe('schedule() debounce', () => {
  it('debounces rapid events for the same path — process called only once', async () => {
    const { service } = makeService();
    const processSpy = jest.spyOn(service as any, 'process').mockResolvedValue(undefined);

    (service as any).schedule('unlink', '/books/file.epub');
    (service as any).schedule('unlink', '/books/file.epub'); // cancels previous
    (service as any).schedule('unlink', '/books/file.epub'); // cancels previous

    jest.runAllTimers();
    await Promise.resolve(); // flush microtasks

    expect(processSpy).toHaveBeenCalledTimes(1);
    expect(processSpy).toHaveBeenCalledWith('unlink', '/books/file.epub');
  });

  it('does not debounce events for different paths', async () => {
    const { service } = makeService();
    const processSpy = jest.spyOn(service as any, 'process').mockResolvedValue(undefined);

    (service as any).schedule('unlink', '/books/file-a.epub');
    (service as any).schedule('unlink', '/books/file-b.epub');

    jest.runAllTimers();
    await Promise.resolve();

    expect(processSpy).toHaveBeenCalledTimes(2);
  });
});
