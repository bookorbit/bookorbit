vi.mock('../scanner/lib/classify', () => ({
  isPrimaryFormat: vi.fn(),
}));

vi.mock('../scanner/lib/stability', () => ({
  waitForStability: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  readdir: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('@parcel/watcher', () => ({
  subscribe: vi.fn(),
}));

import { mkdir, readdir, unlink } from 'fs/promises';
import { subscribe } from '@parcel/watcher';

import { isPrimaryFormat } from '../scanner/lib/classify';
import { waitForStability } from '../scanner/lib/stability';
import { BookBucketWatcherService } from './book-bucket-watcher.service';

function makeService() {
  const config = {
    get: vi.fn().mockReturnValue('/data'),
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
  const service = new BookBucketWatcherService(config as never, ingestService as never, repo as never, gateway as never);
  return { service, ingestService, repo, gateway };
}

describe('BookBucketWatcherService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rescan walks files and emits summary', async () => {
    const { service } = makeService();
    const walkSpy = vi.spyOn(service as any, 'walkAndIngest').mockResolvedValue(undefined);
    const emitSpy = vi.spyOn(service as any, 'emitSummary').mockResolvedValue(undefined);

    await service.rescan();

    expect(walkSpy).toHaveBeenCalledWith('/data/book-bucket');
    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  it('startWatcher ensures directory exists and subscribes for file events', async () => {
    const { service } = makeService();
    vi.mocked(subscribe).mockResolvedValue({ unsubscribe: vi.fn() } as never);

    await (service as any).startWatcher();

    expect(mkdir).toHaveBeenCalledWith('/data/book-bucket', { recursive: true });
    expect(subscribe).toHaveBeenCalledWith('/data/book-bucket', expect.any(Function));
  });

  it('startWatcher swallows watcher boot errors', async () => {
    const { service } = makeService();
    vi.mocked(subscribe).mockRejectedValue(new Error('watch init failed'));

    await expect((service as any).startWatcher()).resolves.toBeUndefined();
  });

  it('process(create) waits for stability and ingests supported file types', async () => {
    const { service, ingestService, gateway } = makeService();
    vi.mocked(isPrimaryFormat).mockReturnValue(true);
    vi.mocked(waitForStability).mockResolvedValue(undefined);
    ingestService.ingestFromWatchedFolder.mockResolvedValue(42);

    await (service as any).process('create', '/data/book-bucket/book.epub');

    expect(waitForStability).toHaveBeenCalledWith('/data/book-bucket/book.epub');
    expect(ingestService.ingestFromWatchedFolder).toHaveBeenCalledWith('/data/book-bucket/book.epub');
    expect(gateway.emitSummary).toHaveBeenCalledWith({ pending: 1, ready: 2, error: 0, total: 3 });
  });

  it('process(delete) removes db row and cover files before emitting summary', async () => {
    const { service, repo, gateway } = makeService();
    repo.findByAbsolutePath.mockResolvedValue({ id: 12, coverPath: '/data/book-bucket/covers/12.jpg' });

    await (service as any).process('delete', '/data/book-bucket/book.epub');

    expect(unlink).toHaveBeenCalledWith('/data/book-bucket/covers/12.jpg');
    expect(unlink).toHaveBeenCalledWith('/data/book-bucket/covers/12_thumb.jpg');
    expect(repo.deleteById).toHaveBeenCalledWith(12);
    expect(gateway.emitSummary).toHaveBeenCalledWith({ pending: 1, ready: 2, error: 0, total: 3 });
  });

  it('walkAndIngest skips covers folder and ingests supported files recursively', async () => {
    const { service, ingestService } = makeService();
    vi.mocked(isPrimaryFormat).mockImplementation((path: string) => path.endsWith('.epub') || path.endsWith('.pdf'));
    vi.mocked(readdir).mockImplementation((dir: string) => {
      if (dir === '/data/book-bucket') {
        return Promise.resolve([
          { name: 'covers', isDirectory: () => true, isFile: () => false },
          { name: 'nested', isDirectory: () => true, isFile: () => false },
          { name: 'root.epub', isDirectory: () => false, isFile: () => true },
        ] as any);
      }
      if (dir === '/data/book-bucket/nested') {
        return Promise.resolve([
          { name: 'inner.pdf', isDirectory: () => false, isFile: () => true },
          { name: 'note.txt', isDirectory: () => false, isFile: () => true },
        ] as any);
      }
      return Promise.resolve([] as any);
    });

    await (service as any).walkAndIngest('/data/book-bucket');

    expect(ingestService.ingestFromWatchedFolder).toHaveBeenCalledWith('/data/book-bucket/root.epub');
    expect(ingestService.ingestFromWatchedFolder).toHaveBeenCalledWith('/data/book-bucket/nested/inner.pdf');
    expect(ingestService.ingestFromWatchedFolder).not.toHaveBeenCalledWith('/data/book-bucket/nested/note.txt');
  });

  it('onModuleDestroy clears timers and unsubscribes active watcher', async () => {
    const { service } = makeService();
    const unsubscribe = vi.fn().mockResolvedValue(undefined);
    (service as any).subscription = { unsubscribe };
    const timer = setTimeout(() => undefined, 1_000);
    (service as any).pendingTimers.set('/tmp/file.epub', { timer, type: 'create' });

    await service.onModuleDestroy();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect((service as any).pendingTimers.size).toBe(0);
    expect((service as any).subscription).toBeNull();
  });
});
