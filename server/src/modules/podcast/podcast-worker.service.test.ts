import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PodcastWorkerService } from './podcast-worker.service';

describe('PodcastWorkerService', () => {
  const gateway = {
    emitDownloadProgress: vi.fn(),
    emitDownloadComplete: vi.fn(),
    emitRefreshComplete: vi.fn(),
    emitImportProgress: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not run overlapping dispatcher ticks', async () => {
    let releaseSchedule!: (value: []) => void;
    const podcasts = {
      findDuePodcasts: vi.fn().mockReturnValue(new Promise<[]>((resolve) => (releaseSchedule = resolve))),
      findPodcastLibraryIds: vi.fn().mockResolvedValue([]),
      findWatchedPodcastLibraryIds: vi.fn().mockResolvedValue([]),
      findDueDigestFollows: vi.fn().mockResolvedValue([]),
    };
    const jobs = {
      enqueue: vi.fn(),
      claimNext: vi.fn(),
      deleteExpiredTerminal: vi.fn().mockResolvedValue(0),
    };
    const worker = new PodcastWorkerService(
      { maxConcurrentDownloads: 2 } as never,
      jobs as never,
      podcasts as never,
      podcasts as never,
      {} as never,
      {} as never,
      {} as never,
      { runLocalShowDiscovery: vi.fn().mockResolvedValue({ discovered: 0, rescans: 0 }) } as never,
      {} as never,
      gateway as never,
      { reconcile: vi.fn().mockResolvedValue(undefined) } as never,
    );

    const firstTick = worker.tick();
    await worker.tick();

    expect(podcasts.findDuePodcasts).toHaveBeenCalledTimes(1);
    expect(jobs.claimNext).not.toHaveBeenCalled();

    releaseSchedule([]);
    await firstTick;
    expect(jobs.claimNext).toHaveBeenCalledTimes(2);
    expect(jobs.claimNext).toHaveBeenNthCalledWith(1, [
      'refresh',
      'reparse',
      'retention',
      'purge',
      'opml_import',
      'import_scan',
      'local_import',
      'merge',
      'digest',
      'file_cleanup',
    ]);
    expect(jobs.claimNext).toHaveBeenNthCalledWith(2, ['download']);
  });

  it('processes a bounded file-cleanup job and completes it', async () => {
    const jobs = {
      isCancellationRequested: vi.fn().mockResolvedValue(false),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
      renewLease: vi.fn().mockResolvedValue(undefined),
    };
    const storage = { removeOrphanedFile: vi.fn().mockResolvedValue(undefined) };
    const worker = new PodcastWorkerService(
      { maxConcurrentDownloads: 2 } as never,
      jobs as never,
      {} as never,
      {} as never,
      {} as never,
      storage as never,
      {} as never,
      {} as never,
      {} as never,
      gateway as never,
      {} as never,
    );
    const job = {
      id: 9,
      type: 'file_cleanup',
      libraryId: 7,
      podcastId: null,
      episodeId: null,
      requestedByUserId: null,
      payload: { path: '/podcasts/show/orphan.mp3' },
      attemptCount: 1,
    };

    await (worker as any).process(job);

    expect(storage.removeOrphanedFile).toHaveBeenCalledWith(7, '/podcasts/show/orphan.mp3');
    expect(jobs.complete).toHaveBeenCalledWith(9);
    expect(jobs.fail).not.toHaveBeenCalled();
  });

  it('dispatches general work independently from the download limit', async () => {
    let releaseRefresh!: () => void;
    let releaseDownload!: () => void;
    const refreshPending = new Promise<void>((resolve) => (releaseRefresh = resolve));
    const downloadPending = new Promise<void>((resolve) => (releaseDownload = resolve));
    let generalClaimed = false;
    let downloadClaimed = false;
    const jobs = {
      enqueue: vi.fn().mockResolvedValue(null),
      claimNext: vi.fn((types: readonly string[]) => {
        if (types.includes('download')) {
          if (downloadClaimed) return Promise.resolve(null);
          downloadClaimed = true;
          return Promise.resolve(job({ id: 12, type: 'download', episodeId: 22 }));
        }
        if (generalClaimed) return Promise.resolve(null);
        generalClaimed = true;
        return Promise.resolve(job({ id: 11, type: 'refresh', podcastId: 33 }));
      }),
      deleteExpiredTerminal: vi.fn().mockResolvedValue(0),
      isCancellationRequested: vi.fn().mockResolvedValue(false),
      renewLease: vi.fn().mockResolvedValue(undefined),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
      updateProgress: vi.fn().mockResolvedValue(undefined),
    };
    const podcasts = {
      findDuePodcasts: vi.fn().mockResolvedValue([]),
      findPodcastLibraryIds: vi.fn().mockResolvedValue([]),
      findWatchedPodcastLibraryIds: vi.fn().mockResolvedValue([]),
      findDueDigestFollows: vi.fn().mockResolvedValue([]),
      findEpisodeMediaContext: vi.fn().mockResolvedValue({
        podcast: { id: 4 },
        media: { status: 'local', sizeBytes: 1024 },
      }),
      findPodcast: vi.fn().mockResolvedValue({ consecutiveFailures: 0, lastError: null }),
    };
    const service = { processRefresh: vi.fn().mockReturnValue(refreshPending.then(() => 0)) };
    const storage = { downloadEpisode: vi.fn().mockReturnValue(downloadPending) };
    const worker = new PodcastWorkerService(
      { maxConcurrentDownloads: 1 } as never,
      jobs as never,
      podcasts as never,
      podcasts as never,
      service as never,
      storage as never,
      {} as never,
      {} as never,
      {} as never,
      gateway as never,
      { reconcile: vi.fn().mockResolvedValue(undefined) } as never,
    );

    await worker.tick();
    await Promise.resolve();

    expect(service.processRefresh).toHaveBeenCalledWith(33);
    expect(storage.downloadEpisode).toHaveBeenCalledWith(22, expect.any(Function));

    releaseRefresh();
    releaseDownload();
    await vi.waitFor(() => expect(jobs.complete).toHaveBeenCalledTimes(2));
  });

  it('carries the persisted batch id through download progress and completion events', async () => {
    const jobs = {
      isCancellationRequested: vi.fn().mockResolvedValue(false),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue('failed'),
      renewLease: vi.fn().mockResolvedValue(undefined),
      updateProgress: vi.fn().mockResolvedValue(undefined),
      enqueue: vi.fn().mockResolvedValue(null),
    };
    const podcasts = {
      findEpisodeMediaContext: vi.fn().mockResolvedValue({
        podcast: { id: 4 },
        media: { status: 'local', sizeBytes: 100 },
      }),
    };
    const storage = {
      downloadEpisode: vi.fn(async (_episodeId: number, progress: (current: number, total: number) => Promise<void>) => progress(50, 100)),
    };
    const worker = new PodcastWorkerService(
      { maxConcurrentDownloads: 1 } as never,
      jobs as never,
      podcasts as never,
      podcasts as never,
      {} as never,
      storage as never,
      {} as never,
      {} as never,
      {} as never,
      gateway as never,
      {} as never,
    );
    const batchId = '0f31ea6f-03f0-4e3d-ae5c-1467ae7ec115';

    await (worker as any).process(job({ id: 13, type: 'download', podcastId: 4, episodeId: 23, downloadBatchId: batchId }));

    expect(gateway.emitDownloadProgress).toHaveBeenCalledWith(expect.objectContaining({ episodeId: 23, batchId, receivedBytes: 50 }));
    expect(gateway.emitDownloadComplete).toHaveBeenCalledWith(
      expect.objectContaining({ episodeId: 23, batchId, jobStatus: 'completed', mediaStatus: 'local' }),
    );
  });

  it('returns media to remote state after a processing download is cancelled', async () => {
    const jobs = {
      isCancellationRequested: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
      renewLease: vi.fn().mockResolvedValue(undefined),
    };
    const storage = {
      downloadEpisode: vi.fn().mockRejectedValue(new Error('Podcast download was cancelled')),
      removeEpisodeDownload: vi.fn().mockResolvedValue(false),
    };
    const podcasts = {
      findEpisodeMediaContext: vi.fn().mockResolvedValue({
        podcast: { id: 4 },
        media: { status: 'remote', sizeBytes: null },
      }),
    };
    const worker = new PodcastWorkerService(
      { maxConcurrentDownloads: 1 } as never,
      jobs as never,
      podcasts as never,
      podcasts as never,
      {} as never,
      storage as never,
      {} as never,
      {} as never,
      {} as never,
      gateway as never,
      {} as never,
    );

    await (worker as any).process(job({ id: 14, type: 'download', episodeId: 24 }));

    expect(jobs.fail).toHaveBeenCalledWith(14, 'Podcast download was cancelled', null);
    expect(storage.removeEpisodeDownload).toHaveBeenCalledWith(24);
  });

  it('runs a reparse job without emitting a refresh result the feed never produced', async () => {
    const jobs = {
      isCancellationRequested: vi.fn().mockResolvedValue(false),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
      renewLease: vi.fn().mockResolvedValue(undefined),
    };
    const service = { processReparse: vi.fn().mockResolvedValue(1) };
    const worker = new PodcastWorkerService(
      { maxConcurrentDownloads: 2 } as never,
      jobs as never,
      {} as never,
      {} as never,
      service as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      gateway as never,
      {} as never,
    );

    await (worker as any).process(job({ id: 15, type: 'reparse', podcastId: 33 }));

    expect(service.processReparse).toHaveBeenCalledWith(33);
    expect(jobs.complete).toHaveBeenCalledWith(15);
    expect(gateway.emitRefreshComplete).not.toHaveBeenCalled();
  });

  it('fails a reparse job that carries no podcast', async () => {
    const jobs = {
      isCancellationRequested: vi.fn().mockResolvedValue(false),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
      renewLease: vi.fn().mockResolvedValue(undefined),
    };
    const service = { processReparse: vi.fn() };
    const worker = new PodcastWorkerService(
      { maxConcurrentDownloads: 2 } as never,
      jobs as never,
      {} as never,
      {} as never,
      service as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      gateway as never,
      {} as never,
    );

    await (worker as any).process(job({ id: 16, type: 'reparse', podcastId: null }));

    expect(service.processReparse).not.toHaveBeenCalled();
    expect(jobs.fail).toHaveBeenCalledWith(16, 'Podcast reparse job is missing podcastId', null);
  });

  it('fails a malformed file-cleanup job without touching storage', async () => {
    const jobs = {
      isCancellationRequested: vi.fn().mockResolvedValue(false),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
      renewLease: vi.fn().mockResolvedValue(undefined),
    };
    const storage = { removeOrphanedFile: vi.fn() };
    const worker = new PodcastWorkerService(
      { maxConcurrentDownloads: 2 } as never,
      jobs as never,
      {} as never,
      {} as never,
      {} as never,
      storage as never,
      {} as never,
      {} as never,
      {} as never,
      gateway as never,
      {} as never,
    );

    await (worker as any).process({
      id: 10,
      type: 'file_cleanup',
      libraryId: 7,
      podcastId: null,
      episodeId: null,
      requestedByUserId: null,
      payload: { path: '' },
      attemptCount: 1,
    });

    expect(storage.removeOrphanedFile).not.toHaveBeenCalled();
    expect(jobs.fail).toHaveBeenCalledWith(10, 'Podcast file cleanup job has an invalid path', null);
  });

  function buildImportScanWorker(overrides: Record<string, unknown>) {
    const jobs = {
      isCancellationRequested: vi.fn().mockResolvedValue(false),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
      renewLease: vi.fn().mockResolvedValue(undefined),
      summaryByType: vi.fn().mockResolvedValue({ queued: 0, processing: 1, failed: 0 }),
    };
    const fileImports = { processImportScan: vi.fn().mockResolvedValue({ attached: 2 }) };
    const localShowImports = {
      processLocalImport: vi.fn(),
      runLocalShowDiscovery: vi.fn().mockResolvedValue({ discovered: 0, rescans: 0, missing: 0, restored: 0 }),
    };
    const scanJob = job({ id: 18, type: 'import_scan', ...overrides });
    const worker = new PodcastWorkerService(
      { maxConcurrentDownloads: 2 } as never,
      jobs as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      fileImports as never,
      localShowImports as never,
      {} as never,
      gateway as never,
      {} as never,
    );
    return { worker, jobs, fileImports, localShowImports, scanJob };
  }

  it('sweeps the folders before an applied import scan and reports its progress lane', async () => {
    const { worker, jobs, fileImports, localShowImports, scanJob } = buildImportScanWorker({ payload: { dryRun: false } });

    await (worker as any).process(scanJob);

    expect(localShowImports.runLocalShowDiscovery).toHaveBeenCalledWith(7);
    expect(fileImports.processImportScan).toHaveBeenCalledWith(scanJob);
    expect(localShowImports.processLocalImport).not.toHaveBeenCalled();
    expect(jobs.complete).toHaveBeenCalledWith(18);
    expect(jobs.summaryByType).toHaveBeenCalledWith(7, 'import_scan');
    expect(gateway.emitImportProgress).toHaveBeenCalledWith(expect.objectContaining({ libraryId: 7, kind: 'local_files' }));
  });

  it('leaves the folder sweep out of a dry run, which must not write', async () => {
    const { worker, fileImports, localShowImports, scanJob } = buildImportScanWorker({ payload: { dryRun: true } });

    await (worker as any).process(scanJob);

    expect(localShowImports.runLocalShowDiscovery).not.toHaveBeenCalled();
    expect(fileImports.processImportScan).toHaveBeenCalledWith(scanJob);
  });

  it('leaves the folder sweep out of a scan narrowed to one show', async () => {
    const { worker, fileImports, localShowImports, scanJob } = buildImportScanWorker({ podcastId: 12, payload: { dryRun: false, podcastId: 12 } });

    await (worker as any).process(scanJob);

    expect(localShowImports.runLocalShowDiscovery).not.toHaveBeenCalled();
    expect(fileImports.processImportScan).toHaveBeenCalledWith(scanJob);
  });

  it('routes a local-show import only to the local-show importer and reports its progress lane', async () => {
    const jobs = {
      isCancellationRequested: vi.fn().mockResolvedValue(false),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
      renewLease: vi.fn().mockResolvedValue(undefined),
      summaryByType: vi.fn().mockResolvedValue({ queued: 0, processing: 0, failed: 0 }),
    };
    const fileImports = { processImportScan: vi.fn() };
    const localShowImports = { processLocalImport: vi.fn().mockResolvedValue({ imported: 3 }) };
    const localImportJob = job({ id: 19, type: 'local_import', payload: { podcastId: 12 } });
    const worker = new PodcastWorkerService(
      { maxConcurrentDownloads: 2 } as never,
      jobs as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      fileImports as never,
      localShowImports as never,
      {} as never,
      gateway as never,
      {} as never,
    );

    await (worker as any).process(localImportJob);

    expect(localShowImports.processLocalImport).toHaveBeenCalledWith(localImportJob);
    expect(fileImports.processImportScan).not.toHaveBeenCalled();
    expect(jobs.complete).toHaveBeenCalledWith(19);
    expect(jobs.summaryByType).toHaveBeenCalledWith(7, 'local_import');
    expect(gateway.emitImportProgress).toHaveBeenCalledWith(expect.objectContaining({ libraryId: 7, kind: 'local_files' }));
  });

  it('sweeps watched podcast libraries for watcher reconcile and local show discovery once per interval', async () => {
    const podcasts = {
      findDuePodcasts: vi.fn().mockResolvedValue([]),
      findPodcastLibraryIds: vi.fn().mockResolvedValue([{ id: 3 }, { id: 4 }]),
      findWatchedPodcastLibraryIds: vi.fn().mockResolvedValue([{ id: 4 }]),
      findDueDigestFollows: vi.fn().mockResolvedValue([]),
    };
    const jobs = {
      enqueue: vi.fn().mockResolvedValue(1),
      deleteExpiredTerminal: vi.fn().mockResolvedValue(0),
    };
    const localShowImports = {
      runLocalShowDiscovery: vi.fn().mockRejectedValueOnce(new Error('unreadable root')).mockResolvedValue({ discovered: 1, rescans: 0 }),
    };
    const localWatcher = { reconcile: vi.fn().mockResolvedValue(undefined) };
    const worker = new PodcastWorkerService(
      { maxConcurrentDownloads: 2 } as never,
      jobs as never,
      podcasts as never,
      podcasts as never,
      {} as never,
      {} as never,
      {} as never,
      localShowImports as never,
      {} as never,
      gateway as never,
      localWatcher as never,
    );

    await worker.scheduleDueWork();

    expect(localWatcher.reconcile).toHaveBeenCalledWith([4]);
    expect(localShowImports.runLocalShowDiscovery).toHaveBeenCalledTimes(1);
    expect(localShowImports.runLocalShowDiscovery).toHaveBeenCalledWith(4);

    await worker.scheduleDueWork();

    expect(localWatcher.reconcile).toHaveBeenCalledTimes(1);
    expect(localShowImports.runLocalShowDiscovery).toHaveBeenCalledTimes(1);
  });
});

function job(overrides: Record<string, unknown>) {
  return {
    id: 1,
    type: 'refresh',
    libraryId: 7,
    podcastId: null,
    episodeId: null,
    requestedByUserId: null,
    downloadBatchId: null,
    payload: {},
    attemptCount: 1,
    ...overrides,
  };
}
