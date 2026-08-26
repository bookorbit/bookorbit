import { ACTIVE_BOOK_REQUEST_DOWNLOAD_STATUSES } from '@bookorbit/types';

import type { BookRequestDownloadRow } from '../../../db/schema';
import type { DownloadStatus } from '../download-clients/download-client-adapter';
import { DownloadMonitorService } from './download-monitor.service';

const HASH_A = 'a'.repeat(40);
const HASH_B = 'b'.repeat(40);

function row(overrides: Partial<BookRequestDownloadRow> = {}): BookRequestDownloadRow {
  return {
    id: 11,
    requestId: 7,
    downloadClientId: 4,
    clientHash: HASH_A,
    status: 'downloading',
    progressPercent: 10,
    downloadedBytes: 100,
    totalBytes: 1000,
    contentPath: null,
    bookDockFileId: null,
    completedAt: null,
    grabbedAt: new Date(Date.now() - 10 * 60 * 1000),
    createdAt: new Date(Date.now() - 10 * 60 * 1000),
    ...overrides,
  } as BookRequestDownloadRow;
}

function status(overrides: Partial<DownloadStatus> = {}): DownloadStatus {
  return {
    infoHash: HASH_A,
    state: 'downloading',
    progressPercent: 50,
    downloadedBytes: 500,
    totalBytes: 1000,
    contentPath: '/downloads/dune.epub',
    ...overrides,
  };
}

function makeService(
  options: {
    active?: BookRequestDownloadRow[];
    statuses?: DownloadStatus[];
    statusError?: Error;
    awaitingImport?: BookRequestDownloadRow[];
    /** The attempt left the active set between the read and the write, so every write is refused. */
    attemptSettled?: boolean;
  } = {},
) {
  // The import runs off the tick now, so it re-reads the attempt rather than working from the row
  // the poll saw. Kept as a store so a write is visible to the read that follows it.
  const stored = new Map<number, BookRequestDownloadRow>(
    [...(options.active ?? [row()]), ...(options.awaitingImport ?? [])].map((stored) => [stored.id, stored]),
  );
  function write(id: number, patch: Record<string, unknown>): BookRequestDownloadRow {
    const next = row({ ...stored.get(id), id, ...patch });
    stored.set(id, next);
    return next;
  }

  const downloads = {
    findActive: vi.fn().mockResolvedValue(options.active ?? [row()]),
    findCompletedAwaitingImport: vi.fn().mockResolvedValue(options.awaitingImport ?? []),
    findById: vi.fn().mockImplementation((id: number) => Promise.resolve(stored.get(id))),
    update: vi.fn().mockImplementation((id: number, patch: Record<string, unknown>) => Promise.resolve(write(id, patch))),
    updateIf: vi
      .fn()
      .mockImplementation((id: number, _expected: unknown, patch: Record<string, unknown>) =>
        Promise.resolve(options.attemptSettled ? undefined : write(id, patch)),
      ),
    touch: vi.fn().mockResolvedValue(0),
  };
  const requests = {
    update: vi.fn().mockResolvedValue(undefined),
    updateIf: vi.fn().mockResolvedValue(undefined),
    findRequestViewerIds: vi.fn().mockImplementation((ids: number[]) => Promise.resolve(new Map(ids.map((id) => [id, [id * 100]])))),
  };
  const clients = { resolveConfig: vi.fn().mockResolvedValue({ id: 4, adapterType: 'qbittorrent' }) };
  const adapter = {
    status: options.statusError ? vi.fn().mockRejectedValue(options.statusError) : vi.fn().mockResolvedValue(options.statuses ?? [status()]),
  };
  const registry = { require: vi.fn().mockReturnValue(adapter) };
  const direct = {
    status: options.statusError ? vi.fn().mockRejectedValue(options.statusError) : vi.fn().mockResolvedValue(options.statuses ?? [status()]),
  };
  const imports = { importDownload: vi.fn().mockResolvedValue(true) };
  const fulfillment = { failDownload: vi.fn().mockResolvedValue(undefined) };
  const gateway = { emitProgress: vi.fn(), emitChanged: vi.fn() };

  const service = new DownloadMonitorService(
    downloads as never,
    requests as never,
    clients as never,
    registry as never,
    direct as never,
    imports as never,
    fulfillment as never,
    gateway as never,
  );

  return { service, downloads, requests, clients, adapter, direct, imports, fulfillment, gateway };
}

/**
 * A tick dispatches its polls rather than awaiting them, so one unreachable client cannot hold up
 * every other download's progress. A test asserting on what a poll wrote has to wait for it.
 */
async function polled(service: DownloadMonitorService): Promise<void> {
  await service.tick();
  await service.whenPollsSettle();
}

/** The imports are off the tick, so a test that asserts on one has to wait for the queue. */
function importQueue(service: DownloadMonitorService): { waitForIdle(): Promise<void> } {
  return (service as unknown as { importQueue: { waitForIdle(): Promise<void> } }).importQueue;
}

/** Long enough for a queued handler to reach its first await, and no longer. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('DownloadMonitorService.tick', () => {
  it('makes no HTTP call at all when nothing is in flight', async () => {
    const { service, clients, adapter } = makeService({ active: [] });
    await polled(service);
    expect(clients.resolveConfig).not.toHaveBeenCalled();
    expect(adapter.status).not.toHaveBeenCalled();
  });

  it('batches every hash for one client into a single call', async () => {
    const { service, adapter } = makeService({
      active: [row(), row({ id: 12, clientHash: HASH_B })],
      statuses: [status(), status({ infoHash: HASH_B })],
    });

    await polled(service);

    expect(adapter.status).toHaveBeenCalledTimes(1);
    expect(adapter.status).toHaveBeenCalledWith([HASH_A, HASH_B], expect.anything());
  });

  it('reports direct HTTP progress on consecutive one-second ticks', async () => {
    const { service, direct, adapter } = makeService({ active: [row({ source: 'direct_url', downloadClientId: null })] });
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(10_000);

    await polled(service);
    now.mockReturnValue(11_000);
    await polled(service);

    expect(direct.status).toHaveBeenCalledTimes(2);
    // A direct file has no client row, so nothing is asked of a download client on its behalf.
    expect(adapter.status).not.toHaveBeenCalled();
    now.mockRestore();
  });

  it('does not increase torrent-client polling beyond once per five seconds', async () => {
    const { service, adapter } = makeService({ active: [row({ source: 'torrent_file' })] });
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(30_000);

    await polled(service);
    // Three seconds later is still inside the window, five seconds later is not.
    now.mockReturnValue(33_000);
    await polled(service);
    now.mockReturnValue(35_000);
    await polled(service);

    expect(adapter.status).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it('records progress and pushes it to the gateway', async () => {
    const { service, downloads, gateway } = makeService();
    await polled(service);

    expect(downloads.updateIf).toHaveBeenCalledWith(
      11,
      ACTIVE_BOOK_REQUEST_DOWNLOAD_STATUSES,
      expect.objectContaining({ status: 'downloading', progressPercent: 50, downloadedBytes: 500, contentPath: '/downloads/dune.epub' }),
    );
    expect(gateway.emitProgress).toHaveBeenCalledWith(expect.objectContaining({ requestId: 7, downloadId: 11, progressPercent: 50 }), [700]);
  });

  it('stamps lastProgressAt only when bytes actually moved, which is what the watchdog reads', async () => {
    const stalled = makeService({ statuses: [status({ downloadedBytes: 100 })] });
    await polled(stalled.service);
    expect(stalled.downloads.updateIf.mock.calls[0][2]).not.toHaveProperty('lastProgressAt');

    const moving = makeService();
    await polled(moving.service);
    expect(moving.downloads.updateIf.mock.calls[0][2]).toHaveProperty('lastProgressAt');
  });

  it('moves the request to downloading once the client stops queueing it', async () => {
    const { service, requests } = makeService({ active: [row({ status: 'queued' })] });
    await polled(service);
    expect(requests.updateIf).toHaveBeenCalledWith(7, expect.arrayContaining(['grabbed']), { status: 'downloading' });
  });

  it('hands a completed download to the importer', async () => {
    const { service, imports, downloads } = makeService({ statuses: [status({ state: 'completed', progressPercent: 100, downloadedBytes: 1000 })] });

    await polled(service);
    await importQueue(service).waitForIdle();

    expect(downloads.updateIf).toHaveBeenCalledWith(
      11,
      ACTIVE_BOOK_REQUEST_DOWNLOAD_STATUSES,
      expect.objectContaining({ status: 'completed', completedAt: expect.any(Date) }),
    );
    expect(imports.importDownload).toHaveBeenCalledTimes(1);
  });

  /**
   * A client poll can take twenty seconds to answer, and a cancellation landing inside that window
   * has already taken the attempt out of the active set. Writing the stale answer back would
   * return the request to `downloading` and, on a completed transfer, carry it into an import.
   */
  describe('a cancellation that lands while a poll is in flight', () => {
    it('drops the stale progress write rather than reviving the attempt', async () => {
      const { service, requests, gateway } = makeService({ active: [row({ status: 'queued' })], attemptSettled: true });

      await polled(service);

      expect(requests.updateIf).not.toHaveBeenCalled();
      expect(gateway.emitProgress).not.toHaveBeenCalled();
    });

    it('does not import a transfer the client reports as finished', async () => {
      const { service, imports } = makeService({
        statuses: [status({ state: 'completed', progressPercent: 100, downloadedBytes: 1000 })],
        attemptSettled: true,
      });

      await polled(service);
      await importQueue(service).waitForIdle();

      expect(imports.importDownload).not.toHaveBeenCalled();
    });
  });

  it('fails a download the client reports as errored', async () => {
    const { service, fulfillment, imports } = makeService({ statuses: [status({ state: 'failed', errorMessage: 'missing files' })] });

    await polled(service);

    expect(fulfillment.failDownload).toHaveBeenCalledWith(expect.objectContaining({ id: 11 }), 'missing files');
    expect(imports.importDownload).not.toHaveBeenCalled();
  });

  /**
   * A client that is down, misconfigured or restarting must not fail every download it holds.
   * That is the watchdog's job, on a much longer clock.
   */
  it('leaves downloads alone when the client cannot be reached', async () => {
    const { service, fulfillment, downloads } = makeService({ statusError: new Error('ECONNREFUSED') });

    await expect(service.tick()).resolves.toBeUndefined();

    expect(fulfillment.failDownload).not.toHaveBeenCalled();
    expect(downloads.updateIf).not.toHaveBeenCalled();
  });

  it('gives a just-grabbed torrent time to appear before calling it missing', async () => {
    const { service, fulfillment } = makeService({ active: [row({ grabbedAt: new Date() })], statuses: [] });
    await polled(service);
    expect(fulfillment.failDownload).not.toHaveBeenCalled();
  });

  it('fails a torrent the client has forgotten once the grace period is over', async () => {
    const { service, fulfillment } = makeService({ active: [row({ grabbedAt: new Date(Date.now() - 5 * 60 * 1000) })], statuses: [] });
    await polled(service);
    expect(fulfillment.failDownload).toHaveBeenCalledWith(expect.objectContaining({ id: 11 }), expect.stringContaining('no longer has this torrent'));
  });

  /**
   * A client that has not started the torrent yet is not the same as one that is transferring,
   * and a card that says "downloading" at 0% for an hour is how a stalled queue looks like a bug.
   */
  it('keeps a queued torrent queued rather than calling it downloading', async () => {
    const { service, downloads, gateway } = makeService({
      active: [row({ status: 'queued', downloadedBytes: 0, progressPercent: 0 })],
      statuses: [status({ state: 'queued', progressPercent: 0, downloadedBytes: 0 })],
    });

    await polled(service);

    expect(downloads.updateIf).toHaveBeenCalledWith(11, ACTIVE_BOOK_REQUEST_DOWNLOAD_STATUSES, expect.objectContaining({ status: 'queued' }));
    expect(gateway.emitProgress).toHaveBeenCalledWith(expect.objectContaining({ status: 'queued' }), [700]);
  });

  /** A state this adapter has no mapping for is in-flight, not idle. */
  it('treats an unmapped client state as downloading', async () => {
    const { service, downloads } = makeService({ statuses: [status({ state: 'unknown' })] });
    await polled(service);
    expect(downloads.updateIf).toHaveBeenCalledWith(11, ACTIVE_BOOK_REQUEST_DOWNLOAD_STATUSES, expect.objectContaining({ status: 'downloading' }));
  });

  /**
   * The bytes are already on disk; nothing else would ever look at this row again, because the
   * poll query stops at `downloading` and the watchdog only knows how to fail it.
   */
  it('resumes a completed download whose import never ran', async () => {
    const stranded = row({ id: 21, status: 'completed', bookDockFileId: null });
    const { service, imports } = makeService({ active: [], awaitingImport: [stranded] });

    await polled(service);
    await importQueue(service).waitForIdle();

    expect(imports.importDownload).toHaveBeenCalledWith(stranded);
  });

  /**
   * Extracting a release takes minutes and the tick is a process-wide critical section, so an
   * import awaited inside it stops progress polling and completion handling for everything else.
   */
  describe('an import that takes minutes', () => {
    function makeBlockedImport(context: ReturnType<typeof makeService>): () => void {
      let finish: () => void = () => {};
      context.imports.importDownload.mockReturnValue(
        new Promise<boolean>((resolve) => {
          finish = () => resolve(true);
        }),
      );
      return finish;
    }

    it('does not hold the poll loop while it runs', async () => {
      const now = vi.spyOn(Date, 'now');
      now.mockReturnValue(60_000);
      const context = makeService({ statuses: [status({ state: 'completed', progressPercent: 100, downloadedBytes: 1000 })] });
      const finishImport = makeBlockedImport(context);

      await polled(context.service);
      await flush();
      expect(context.imports.importDownload).toHaveBeenCalledTimes(1);

      // A second transfer reports five seconds later, with the first import still running.
      context.downloads.findActive.mockResolvedValue([row({ id: 12, clientHash: HASH_B })]);
      context.adapter.status.mockResolvedValue([status({ infoHash: HASH_B, progressPercent: 40, downloadedBytes: 400 })]);
      now.mockReturnValue(66_000);
      await polled(context.service);

      expect(context.gateway.emitProgress).toHaveBeenCalledWith(expect.objectContaining({ downloadId: 12, progressPercent: 40 }), expect.any(Array));
      finishImport();
      await importQueue(context.service).waitForIdle();
      now.mockRestore();
    });

    /** The row stays `completed` until the extraction is done, so the sweep keeps finding it. */
    it('is not started a second time by the resume sweep that keeps finding it', async () => {
      const now = vi.spyOn(Date, 'now');
      now.mockReturnValue(100_000);
      const context = makeService({ active: [], awaitingImport: [row({ id: 21, status: 'completed', bookDockFileId: null })] });
      const finishImport = makeBlockedImport(context);

      await polled(context.service);
      await flush();
      now.mockReturnValue(120_000);
      await polled(context.service);
      await flush();

      expect(context.imports.importDownload).toHaveBeenCalledTimes(1);
      finishImport();
      await importQueue(context.service).waitForIdle();
      now.mockRestore();
    });
  });

  /** Queued behind another import for as long as that one takes, which is long enough to matter. */
  it('drops an import whose attempt was settled while it waited', async () => {
    const { service, imports, downloads } = makeService({ active: [], awaitingImport: [row({ id: 21, status: 'completed', bookDockFileId: null })] });
    downloads.findById.mockResolvedValue(row({ id: 21, status: 'failed' }));

    await polled(service);
    await importQueue(service).waitForIdle();

    expect(imports.importDownload).not.toHaveBeenCalled();
  });

  /**
   * The symptom that made this worth changing: one client on a twenty-second timeout used to hold
   * the whole tick, so direct transfers - which report once a second - froze along with every
   * other client's progress and every completion.
   */
  describe('one client that will not answer', () => {
    /** A torrent client whose read never comes back, and a direct transfer alongside it. */
    function stalledClient() {
      const context = makeService({
        active: [row(), row({ id: 12, source: 'direct_url', downloadClientId: null, clientHash: HASH_B })],
        statuses: [status({ infoHash: HASH_B })],
      });
      let release: () => void = () => {};
      context.adapter.status.mockReturnValue(new Promise<DownloadStatus[]>((resolve) => (release = () => resolve([]))));
      return { ...context, release };
    }

    it('reports the other targets while it is still waiting', async () => {
      const { service, direct, release } = stalledClient();

      await service.tick();
      await flush();

      expect(direct.status).toHaveBeenCalledTimes(1);
      release();
      await service.whenPollsSettle();
    });

    it('does not queue a second read behind the one still in flight', async () => {
      const { service, adapter, direct, release } = stalledClient();
      const now = vi.spyOn(Date, 'now');

      now.mockReturnValue(60_000);
      await service.tick();
      await flush();
      now.mockReturnValue(90_000);
      await service.tick();
      await flush();

      expect(adapter.status).toHaveBeenCalledTimes(1);
      // The direct transfer is polled on both ticks, because nothing of its own is outstanding.
      expect(direct.status).toHaveBeenCalledTimes(2);
      release();
      await service.whenPollsSettle();
      now.mockRestore();
    });
  });

  /**
   * Direct progress lives in memory, so a restart leaves a transfer nothing can resume. The
   * service reports it the way a client reports a torrent it does not hold - by leaving it out -
   * and the reason says so rather than blaming a download client the transfer never used.
   */
  it('fails an interrupted direct transfer once its grace period is over', async () => {
    const { service, fulfillment } = makeService({
      active: [row({ source: 'direct_url', downloadClientId: null })],
      statuses: [],
    });

    await polled(service);

    expect(fulfillment.failDownload).toHaveBeenCalledWith(expect.objectContaining({ id: 11 }), expect.stringContaining('cannot be resumed'));
  });

  /**
   * Import concurrency is one and a queued row receives no writes, so without this the watchdog
   * ages a perfectly healthy import past its hour on queue depth alone.
   */
  it('tells the database that queued and running imports are still being worked on', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(500_000);
    const context = makeService({ active: [], awaitingImport: [row({ id: 21, status: 'completed', bookDockFileId: null })] });
    let finishImport: () => void = () => {};
    context.imports.importDownload.mockReturnValue(new Promise<boolean>((resolve) => (finishImport = () => resolve(true))));

    await polled(context.service);
    await flush();
    // A minute on, with the import still running and nothing else having written to its row.
    now.mockReturnValue(600_000);
    await polled(context.service);

    expect(context.downloads.touch).toHaveBeenCalledWith([21]);
    finishImport();
    await importQueue(context.service).waitForIdle();
    now.mockRestore();
  });

  it('does not start a second pass while one is still running', async () => {
    const { service, downloads } = makeService();
    // Resolved up front rather than from inside the mock: the tick reaches `findActive` several
    // microtasks in, and a release wired on the call itself would fire before the call exists.
    let release: () => void = () => {};
    const blocked = new Promise<BookRequestDownloadRow[]>((resolve) => {
      release = () => resolve([]);
    });
    downloads.findActive.mockReturnValue(blocked);

    const first = service.tick();
    await service.tick();
    release();
    await first;

    expect(downloads.findActive).toHaveBeenCalledTimes(1);
  });
  /**
   * qBittorrent has no error state for a refused announce, so the torrent reads as an ordinary
   * stalled download. Without this the only symptom is a request that never starts and then fails
   * twelve hours later saying nothing about why.
   */
  describe('a tracker that refuses the announce', () => {
    const REFUSED = 'Unrecognized host/PassKey. (97.117.96.134)';

    it("fails the download with the tracker's own message", async () => {
      const { service, fulfillment } = makeService({
        statuses: [status({ downloadedBytes: 0, progressPercent: 0, trackerError: REFUSED })],
      });

      await polled(service);

      expect(fulfillment.failDownload).toHaveBeenCalledWith(expect.objectContaining({ id: 11 }), expect.stringContaining(REFUSED));
    });

    /** A tracker restart looks identical for the first few seconds, and costs nobody a download. */
    it('gives a freshly grabbed torrent a grace window first', async () => {
      const now = new Date();
      const { service, fulfillment, downloads } = makeService({
        active: [row({ grabbedAt: now, createdAt: now })],
        statuses: [status({ downloadedBytes: 0, progressPercent: 0, trackerError: REFUSED })],
      });

      await polled(service);

      expect(fulfillment.failDownload).not.toHaveBeenCalled();
      expect(downloads.updateIf).toHaveBeenCalled();
    });

    /** Multi-tracker torrents download fine on one working tracker while another shouts. */
    it('leaves a torrent alone once bytes are actually arriving', async () => {
      const { service, fulfillment } = makeService({
        statuses: [status({ downloadedBytes: 4096, trackerError: REFUSED })],
      });

      await polled(service);

      expect(fulfillment.failDownload).not.toHaveBeenCalled();
    });
  });
});
