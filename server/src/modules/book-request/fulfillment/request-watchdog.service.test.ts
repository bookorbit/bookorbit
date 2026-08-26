import type { BookRequestDownloadRow } from '../../../db/schema';
import { RequestWatchdogService } from './request-watchdog.service';

function makeService(
  byStatus: Record<string, BookRequestDownloadRow[]> = {},
  abandoned: Array<{ id: number; userId: number }> = [],
  stranded: Array<{ id: number }> = [],
) {
  const downloads = {
    findByStatusOlderThan: vi.fn().mockImplementation((statuses: string[]) => Promise.resolve(byStatus[statuses.join(',')] ?? [])),
    findLiveDirectHashes: vi.fn().mockResolvedValue([]),
  };
  const fulfillment = { failDownload: vi.fn().mockResolvedValue(undefined) };
  const requests = {
    findAbandonedSelfServe: vi.fn().mockResolvedValue(abandoned),
    cancelAbandoned: vi.fn().mockResolvedValue(true),
    dismiss: vi.fn().mockResolvedValue(undefined),
    // One batch, then nothing: the sweep loops until a short batch comes back.
    findStrandedSearching: vi.fn().mockResolvedValueOnce(stranded).mockResolvedValue([]),
    updateIf: vi.fn().mockResolvedValue({ id: 1 }),
  };
  const gateway = { emitChanged: vi.fn() };
  const auditEvents = { emit: vi.fn() };
  const direct = { reapStaging: vi.fn().mockResolvedValue(0) };

  return {
    service: new RequestWatchdogService(
      downloads as never,
      fulfillment as never,
      requests as never,
      gateway as never,
      auditEvents as never,
      direct as never,
    ),
    downloads,
    fulfillment,
    requests,
    gateway,
    auditEvents,
    direct,
  };
}

describe('RequestWatchdogService.sweep', () => {
  it('measures a stalled download from the last time bytes moved', async () => {
    const { service, downloads } = makeService();
    await service.sweep();

    expect(downloads.findByStatusOlderThan).toHaveBeenCalledWith(['queued', 'downloading'], expect.any(Date), 'progress');
  });

  /**
   * An import's `lastProgressAt` belongs to the download that already finished, so measuring the
   * import from it would make every import look ancient the moment it started.
   */
  it('measures a stuck import from its last state change instead', async () => {
    const { service, downloads } = makeService();
    await service.sweep();

    expect(downloads.findByStatusOlderThan).toHaveBeenCalledWith(['completed', 'importing'], expect.any(Date), 'state-change');
  });

  it('never sweeps a row held for human review', async () => {
    const { service, downloads } = makeService();
    await service.sweep();

    for (const call of downloads.findByStatusOlderThan.mock.calls) {
      expect(call[0]).not.toContain('needs_review');
    }
  });

  it('fails every row it finds, with a reason that says what happened', async () => {
    const { service, fulfillment } = makeService({
      'queued,downloading': [{ id: 11 } as BookRequestDownloadRow, { id: 12 } as BookRequestDownloadRow],
      'completed,importing': [{ id: 13 } as BookRequestDownloadRow],
    });

    await service.sweep();

    expect(fulfillment.failDownload).toHaveBeenCalledTimes(3);
    expect(fulfillment.failDownload).toHaveBeenCalledWith({ id: 11 }, 'The download made no progress for 12 hours');
    expect(fulfillment.failDownload).toHaveBeenCalledWith({ id: 13 }, 'The import did not finish within an hour');
  });

  it('swallows a sweep failure rather than crashing the scheduler', async () => {
    const { service } = makeService();
    const downloads = { findByStatusOlderThan: vi.fn().mockRejectedValue(new Error('db down')) };
    const broken = new RequestWatchdogService(downloads as never, { failDownload: vi.fn() } as never);

    await expect(broken.sweep()).resolves.toBeUndefined();
    await expect(service.sweep()).resolves.toBeUndefined();
  });
});

/**
 * `searching` is claimed by a fire-and-forget task that lives only in this process, so nothing
 * outside that task ever clears it: a restart or a throw its handler cannot reach leaves the
 * status without the work, holding the dedupe claim on that book forever.
 */
describe('RequestWatchdogService stranded searches', () => {
  it('returns a request nothing is searching for to approved, so an approver can pick a release', async () => {
    const { service, requests, gateway } = makeService({}, [], [{ id: 7 }]);

    await service.sweep();

    expect(requests.updateIf).toHaveBeenCalledWith(7, ['searching'], { status: 'approved' });
    expect(gateway.emitChanged).toHaveBeenCalled();
  });

  /** Minutes at its very worst, so half an hour is an accident rather than a slow tracker. */
  it('gives a running search half an hour before treating it as stranded', async () => {
    const { service, requests } = makeService();
    const before = Date.now();

    await service.sweep();

    const [cutoff] = requests.findStrandedSearching.mock.calls[0] as [Date, number];
    expect(cutoff.getTime()).toBeLessThanOrEqual(before - 30 * 60 * 1000);
    expect(cutoff.getTime()).toBeGreaterThan(before - 31 * 60 * 1000);
  });

  /** No in-memory task survives a restart, so every one of these is stranded, however recent. */
  it('reconciles every searching request at boot rather than waiting out the timeout', async () => {
    const { service, requests } = makeService({}, [], [{ id: 7 }]);
    const before = Date.now();

    await service.onApplicationBootstrap();

    const [cutoff] = requests.findStrandedSearching.mock.calls[0] as [Date, number];
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before);
    expect(requests.updateIf).toHaveBeenCalledWith(7, ['searching'], { status: 'approved' });
  });

  /** An automation pass that is genuinely still running keeps whatever it decides. */
  it('leaves a row alone when the conditional write finds it already moved on', async () => {
    const { service, requests, gateway } = makeService({}, [], [{ id: 7 }]);
    requests.updateIf.mockResolvedValue(undefined);

    await service.sweep();

    expect(gateway.emitChanged).not.toHaveBeenCalled();
  });
});

/**
 * Direct-download progress lives in memory, so a transfer a restart interrupted leaves bytes
 * nothing will poll, import or remove - and each failed URL stages under its own hash.
 */
describe('RequestWatchdogService staging reap', () => {
  it('reaps staging against the attempts that could still read it', async () => {
    const { service, downloads, direct } = makeService();
    downloads.findLiveDirectHashes.mockResolvedValue(['aaa', 'bbb']);

    await service.onApplicationBootstrap();

    expect(direct.reapStaging).toHaveBeenCalledWith(new Set(['aaa', 'bbb']));
  });

  /** Neither reconciliation is worth refusing to start over. */
  it('starts anyway when a startup reconciliation fails', async () => {
    const { service, downloads, requests } = makeService();
    // Reset first: the harness queues a one-shot batch that would be consumed before the rejection.
    requests.findStrandedSearching.mockReset().mockRejectedValue(new Error('db down'));
    downloads.findLiveDirectHashes.mockRejectedValue(new Error('db down'));

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});

describe('RequestWatchdogService abandoned self-serve sweep', () => {
  /**
   * The failure mode creating the row up front introduces: a live request holds the dedupe claim
   * on its work, so an abandoned one silently subscribes the next asker to a request nobody drives.
   */
  it('cancels a self-serve request nobody picked a release for, and hides it from its owner', async () => {
    const { service, requests, gateway } = makeService({}, [{ id: 7, userId: 3 }]);

    await service.sweep();

    expect(requests.findAbandonedSelfServe).toHaveBeenCalledWith(expect.any(Date), 50);
    expect(requests.cancelAbandoned).toHaveBeenCalledWith(7, expect.stringContaining('No release was picked'), 'ABANDONED');
    expect(requests.dismiss).toHaveBeenCalledWith(7, 3);
    expect(gateway.emitChanged).toHaveBeenCalled();
  });

  /** A cron never reaches the audit interceptor, so the record has to be emitted by hand. */
  it('records the cancellation in the audit log', async () => {
    const { service, auditEvents } = makeService({}, [{ id: 7, userId: 3 }]);

    await service.sweep();

    expect(auditEvents.emit).toHaveBeenCalledWith(
      'audit.log',
      expect.objectContaining({ resourceId: 7, actorUsername: 'system', meta: { requestId: 7, ownerId: 3 } }),
    );
  });

  /** Somebody grabbing between the read and the write wins; the sweep is not allowed to overrule it. */
  it('leaves a row alone when the conditional cancel finds it already moved on', async () => {
    const { service, requests, gateway, auditEvents } = makeService({}, [{ id: 7, userId: 3 }]);
    requests.cancelAbandoned.mockResolvedValue(false);

    await service.sweep();

    expect(requests.dismiss).not.toHaveBeenCalled();
    expect(auditEvents.emit).not.toHaveBeenCalled();
    expect(gateway.emitChanged).not.toHaveBeenCalled();
  });

  it('does not touch the gateway when there is nothing to sweep', async () => {
    const { service, requests, gateway } = makeService();

    await service.sweep();

    expect(requests.cancelAbandoned).not.toHaveBeenCalled();
    expect(gateway.emitChanged).not.toHaveBeenCalled();
  });
});
