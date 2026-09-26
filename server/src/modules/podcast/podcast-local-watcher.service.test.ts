vi.mock('fs/promises', () => ({
  realpath: vi.fn().mockImplementation((p: string) => Promise.resolve(p)),
}));

vi.mock('chokidar', () => ({
  watch: vi.fn(),
}));

import { watch } from 'chokidar';
import { realpath } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SelfWriteRegistry } from '../../common/services/self-write-registry.service';
import { PodcastLocalWatcherService } from './podcast-local-watcher.service';

const ARCHIVE = '/media/archive';

function makeReadyWatcher() {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const watcher = {
    on: vi.fn().mockImplementation((eventName: string, handler: (...args: unknown[]) => void) => {
      handlers.set(eventName, handler);
      return watcher;
    }),
    once: vi.fn().mockImplementation((eventName: string, handler: () => void) => {
      if (eventName === 'ready') handler();
      return watcher;
    }),
    off: vi.fn().mockReturnThis(),
    close: vi.fn().mockResolvedValue(undefined),
    emitAll: (eventName: string, path: string) => handlers.get('all')?.(eventName, path),
  };
  return watcher;
}

function makeService() {
  const repo = {
    findLocalLibraryFolders: vi.fn().mockResolvedValue([ARCHIVE]),
  };
  const imports = {
    runLocalShowDiscovery: vi.fn().mockResolvedValue({ discovered: 0, rescans: 0, missing: 0, restored: 0 }),
    syncLocalShowFolder: vi.fn().mockResolvedValue({ outcome: 'rescan', jobId: 1 }),
    markLocalShowMissingIfGone: vi.fn().mockResolvedValue(true),
  };
  const selfWrites = new SelfWriteRegistry();
  const service = new PodcastLocalWatcherService(repo as never, imports as never, selfWrites);
  return { service, repo, imports, selfWrites };
}

describe('PodcastLocalWatcherService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(realpath).mockImplementation((p) => Promise.resolve(p as string));
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reconcile watches each local root of a podcast library and kicks discovery', async () => {
    const { service, repo, imports } = makeService();
    repo.findLocalLibraryFolders.mockResolvedValue([ARCHIVE, '/media/second']);
    vi.mocked(watch).mockReturnValue(makeReadyWatcher() as never);

    await service.reconcile([5]);
    await vi.advanceTimersByTimeAsync(0);

    expect(watch).toHaveBeenCalledWith(ARCHIVE, { ignoreInitial: true, depth: 2 });
    expect(watch).toHaveBeenCalledWith('/media/second', { ignoreInitial: true, depth: 2 });
    expect(imports.runLocalShowDiscovery).toHaveBeenCalledWith(5);
  });

  it('leaves the downloads root unwatched when the library has no local roots', async () => {
    const { service, repo, imports } = makeService();
    repo.findLocalLibraryFolders.mockResolvedValue([]);

    await service.reconcile([5]);
    await vi.advanceTimersByTimeAsync(0);

    expect(watch).not.toHaveBeenCalled();
    expect(imports.runLocalShowDiscovery).not.toHaveBeenCalled();
  });

  it('reconcile leaves an unchanged library alone and stops one that disappeared', async () => {
    const { service } = makeService();
    const watcher = makeReadyWatcher();
    vi.mocked(watch).mockReturnValue(watcher as never);

    await service.reconcile([5]);
    await service.reconcile([5]);
    expect(watch).toHaveBeenCalledTimes(1);

    await service.reconcile([]);
    expect(watcher.close).toHaveBeenCalled();
  });

  it('reconcile restarts the watchers when the local roots changed', async () => {
    const { service, repo } = makeService();
    const first = makeReadyWatcher();
    const second = makeReadyWatcher();
    vi.mocked(watch)
      .mockReturnValueOnce(first as never)
      .mockReturnValueOnce(second as never);

    await service.reconcile([5]);
    repo.findLocalLibraryFolders.mockResolvedValue(['/media/moved']);
    await service.reconcile([5]);

    expect(first.close).toHaveBeenCalled();
    expect(watch).toHaveBeenLastCalledWith('/media/moved', { ignoreInitial: true, depth: 2 });
  });

  it('keeps watching the roots it reached when one of them is unreadable', async () => {
    const { service, repo, imports } = makeService();
    repo.findLocalLibraryFolders.mockResolvedValue(['/media/offline', ARCHIVE]);
    vi.mocked(realpath).mockImplementation((p) => (p === '/media/offline' ? Promise.reject(new Error('ENOENT')) : Promise.resolve(p as string)));
    vi.mocked(watch).mockReturnValue(makeReadyWatcher() as never);

    await service.reconcile([5]);
    await vi.advanceTimersByTimeAsync(0);

    expect(watch).toHaveBeenCalledTimes(1);
    expect(watch).toHaveBeenCalledWith(ARCHIVE, { ignoreInitial: true, depth: 2 });
    expect(imports.runLocalShowDiscovery).toHaveBeenCalledWith(5);
  });

  it('rests a library whose watchers all failed to start instead of retrying every sweep', async () => {
    const { service } = makeService();
    vi.mocked(realpath).mockRejectedValue(new Error('read-only mount'));

    await service.reconcile([5]);
    await service.reconcile([5]);

    expect(realpath).toHaveBeenCalledTimes(1);
    expect(watch).not.toHaveBeenCalled();
  });

  it('debounces a burst of file events into one sync of the show folder', async () => {
    const { service, imports } = makeService();
    const watcher = makeReadyWatcher();
    vi.mocked(watch).mockReturnValue(watcher as never);
    await service.reconcile([5]);

    watcher.emitAll('add', join(ARCHIVE, 'Field Notes', 'ep1.mp3'));
    watcher.emitAll('add', join(ARCHIVE, 'Field Notes', 'Season 01', 'ep2.mp3'));
    watcher.emitAll('addDir', join(ARCHIVE, 'Field Notes'));
    await vi.advanceTimersByTimeAsync(2_100);

    expect(imports.syncLocalShowFolder).toHaveBeenCalledTimes(1);
    expect(imports.syncLocalShowFolder).toHaveBeenCalledWith(5, join(ARCHIVE, 'Field Notes'));
  });

  it('re-checks a folder later when its show already had an import running', async () => {
    const { service, imports } = makeService();
    const watcher = makeReadyWatcher();
    vi.mocked(watch).mockReturnValue(watcher as never);
    imports.syncLocalShowFolder.mockResolvedValueOnce({ outcome: 'deferred', jobId: null });
    await service.reconcile([5]);

    watcher.emitAll('add', join(ARCHIVE, 'Busy Show', 'ep1.mp3'));
    await vi.advanceTimersByTimeAsync(2_100);
    expect(imports.syncLocalShowFolder).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_100);
    expect(imports.syncLocalShowFolder).toHaveBeenCalledTimes(2);
  });

  it('checks the show folder when a delete lands under it', async () => {
    const { service, imports } = makeService();
    const watcher = makeReadyWatcher();
    vi.mocked(watch).mockReturnValue(watcher as never);
    await service.reconcile([5]);

    watcher.emitAll('unlink', join(ARCHIVE, 'Field Notes', 'ep1.mp3'));
    watcher.emitAll('unlinkDir', join(ARCHIVE, 'Field Notes'));
    await vi.advanceTimersByTimeAsync(5_000);

    expect(imports.markLocalShowMissingIfGone).toHaveBeenCalledTimes(1);
    expect(imports.markLocalShowMissingIfGone).toHaveBeenCalledWith(5, join(ARCHIVE, 'Field Notes'));
    expect(imports.syncLocalShowFolder).not.toHaveBeenCalled();
  });

  it('ignores events on the watched root itself', async () => {
    const { service, imports } = makeService();
    const watcher = makeReadyWatcher();
    vi.mocked(watch).mockReturnValue(watcher as never);
    await service.reconcile([5]);

    watcher.emitAll('addDir', ARCHIVE);
    watcher.emitAll('unlinkDir', ARCHIVE);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(imports.syncLocalShowFolder).not.toHaveBeenCalled();
    expect(imports.markLocalShowMissingIfGone).not.toHaveBeenCalled();
  });

  it('lets the folder that came back win over the delete that preceded it', async () => {
    const { service, imports } = makeService();
    const watcher = makeReadyWatcher();
    vi.mocked(watch).mockReturnValue(watcher as never);
    await service.reconcile([5]);

    watcher.emitAll('unlinkDir', join(ARCHIVE, 'Field Notes'));
    watcher.emitAll('addDir', join(ARCHIVE, 'Field Notes'));
    await vi.advanceTimersByTimeAsync(5_000);

    expect(imports.markLocalShowMissingIfGone).not.toHaveBeenCalled();
    expect(imports.syncLocalShowFolder).toHaveBeenCalledWith(5, join(ARCHIVE, 'Field Notes'));
  });

  it('ignores a sidecar BookOrbit is writing back', async () => {
    const { service, imports, selfWrites } = makeService();
    const watcher = makeReadyWatcher();
    vi.mocked(watch).mockReturnValue(watcher as never);
    await service.reconcile([5]);
    const sidecar = join(ARCHIVE, 'Field Notes', 'metadata.json');

    selfWrites.begin([sidecar]);
    watcher.emitAll('add', sidecar);
    await vi.advanceTimersByTimeAsync(2_100);
    expect(imports.syncLocalShowFolder).not.toHaveBeenCalled();

    // Once the write is done the same path is ordinary news again.
    selfWrites.end([sidecar]);
    watcher.emitAll('add', sidecar);
    await vi.advanceTimersByTimeAsync(2_100);
    expect(imports.syncLocalShowFolder).toHaveBeenCalledTimes(1);
  });

  it('dropping a library also drops its pending syncs', async () => {
    const { service, imports } = makeService();
    const watcher = makeReadyWatcher();
    vi.mocked(watch).mockReturnValue(watcher as never);
    await service.reconcile([5]);

    watcher.emitAll('add', join(ARCHIVE, 'Field Notes', 'ep1.mp3'));
    await service.reconcile([]);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(watcher.close).toHaveBeenCalled();
    expect(imports.syncLocalShowFolder).not.toHaveBeenCalled();
  });
});
