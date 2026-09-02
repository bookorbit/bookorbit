import { BadRequestException } from '@nestjs/common';

import type { BookRequestDownloadRow } from '../../../db/schema';
import type { ReconciliationAttemptRow } from '../fulfillment/book-request-download.repository';
import { DownloadClientReconciliationService } from './download-client-reconciliation.service';

const CLIENT_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ORPHAN_HASH = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const MISSING_HASH = 'cccccccccccccccccccccccccccccccccccccccc';

function attempt(
  id: number,
  requestId: number,
  clientHash: string,
  status: BookRequestDownloadRow['status'],
  requestTitle: string,
): ReconciliationAttemptRow {
  return {
    download: { id, requestId, clientHash, status } as BookRequestDownloadRow,
    requestTitle,
  };
}

function owned(infoHash: string, state: 'queued' | 'downloading' | 'completed' = 'downloading') {
  return {
    infoHash,
    name: `Item ${infoHash.slice(0, 4)}`,
    state,
    progressPercent: state === 'completed' ? 100 : 35,
    downloadedBytes: 350,
    totalBytes: 1000,
    contentPath: '/downloads/item',
  } as const;
}

function makeService() {
  const clients = {
    resolveConfig: vi.fn().mockResolvedValue({ id: 4, adapterType: 'qbittorrent', category: 'bookorbit' }),
  };
  const adapter = {
    listOwned: vi.fn().mockResolvedValue({ supported: true, truncated: false, items: [] }),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const registry = { require: vi.fn().mockReturnValue(adapter) };
  const downloads = {
    findTrackedForClientHashes: vi.fn().mockResolvedValue([]),
    findAdoptableForHashes: vi.fn().mockResolvedValue([]),
    findActiveForClient: vi.fn().mockResolvedValue([]),
    adoptFailedAttempt: vi.fn(),
  };
  const gateway = { emitChanged: vi.fn() };
  const service = new DownloadClientReconciliationService(clients as never, registry as never, downloads as never, gateway as never);

  return { service, clients, adapter, registry, downloads, gateway };
}

describe('DownloadClientReconciliationService', () => {
  it('diffs the client inventory against tracked, adoptable, and missing attempts', async () => {
    const { service, adapter, downloads } = makeService();
    const tracked = attempt(11, 7, CLIENT_HASH, 'downloading', 'Tracked book');
    const adoptable = attempt(12, 8, ORPHAN_HASH, 'failed', 'Retry this book');
    const missing = attempt(13, 9, MISSING_HASH, 'queued', 'Missing book');
    adapter.listOwned.mockResolvedValue({
      supported: true,
      truncated: false,
      items: [owned(CLIENT_HASH), owned(ORPHAN_HASH, 'completed')],
    });
    downloads.findTrackedForClientHashes.mockResolvedValue([tracked]);
    downloads.findAdoptableForHashes.mockResolvedValue([adoptable]);
    downloads.findActiveForClient.mockResolvedValue([tracked, missing]);

    const result = await service.reconcile(4);

    expect(result).toMatchObject({
      clientId: 4,
      supported: true,
      ownershipMarker: 'bookorbit',
      truncated: false,
      items: [
        {
          infoHash: CLIENT_HASH,
          trackedAttempt: { downloadId: 11, requestId: 7, requestTitle: 'Tracked book', status: 'downloading' },
          adoptableAttempts: [],
        },
        {
          infoHash: ORPHAN_HASH,
          trackedAttempt: null,
          adoptableAttempts: [{ downloadId: 12, requestId: 8, requestTitle: 'Retry this book', status: 'failed' }],
        },
      ],
      missingAttempts: [{ downloadId: 13, requestId: 9, requestTitle: 'Missing book', status: 'queued' }],
    });
  });

  it('does not report missing attempts from a truncated client inventory', async () => {
    const { service, adapter, downloads } = makeService();
    adapter.listOwned.mockResolvedValue({ supported: true, truncated: true, items: [owned(CLIENT_HASH)] });

    const result = await service.reconcile(4);

    expect(result.truncated).toBe(true);
    expect(result.missingAttempts).toEqual([]);
    expect(downloads.findActiveForClient).not.toHaveBeenCalled();
  });

  it('reports a client whose ownership marker cannot be enumerated as unsupported', async () => {
    const { service, adapter, downloads } = makeService();
    adapter.listOwned.mockResolvedValue({ supported: false, truncated: false, items: [] });

    await expect(service.reconcile(4)).resolves.toMatchObject({ supported: false, ownershipMarker: 'bookorbit', items: [] });
    expect(downloads.findTrackedForClientHashes).not.toHaveBeenCalled();
  });

  it('rechecks the client item and adopts the exact failed attempt atomically', async () => {
    const { service, adapter, downloads, gateway } = makeService();
    const candidate = attempt(12, 8, ORPHAN_HASH, 'failed', 'Retry this book');
    const adopted = { ...candidate.download, downloadClientId: 4, status: 'completed' } as BookRequestDownloadRow;
    adapter.listOwned.mockResolvedValue({ supported: true, truncated: false, items: [owned(ORPHAN_HASH, 'completed')] });
    downloads.findAdoptableForHashes.mockResolvedValue([candidate]);
    downloads.adoptFailedAttempt.mockResolvedValue(adopted);

    await expect(service.adopt(4, ORPHAN_HASH.toUpperCase(), 12)).resolves.toEqual({
      downloadId: 12,
      requestId: 8,
      requestTitle: 'Retry this book',
      status: 'completed',
    });
    expect(downloads.adoptFailedAttempt).toHaveBeenCalledWith(12, 4, ORPHAN_HASH, {
      status: 'completed',
      progressPercent: 100,
      downloadedBytes: 350,
      totalBytes: 1000,
      contentPath: '/downloads/item',
    });
    expect(gateway.emitChanged).toHaveBeenCalledTimes(1);
  });

  it('refuses to remove an item once any database attempt owns it', async () => {
    const { service, adapter, downloads } = makeService();
    adapter.listOwned.mockResolvedValue({ supported: true, truncated: false, items: [owned(ORPHAN_HASH)] });
    downloads.findTrackedForClientHashes.mockResolvedValue([attempt(12, 8, ORPHAN_HASH, 'failed', 'Tracked book')]);

    await expect(service.removeOrphan(4, ORPHAN_HASH, false)).rejects.toMatchObject({
      response: { errorCode: 'DOWNLOAD_CLIENT_RECONCILIATION_NOT_ORPHAN' },
    });
    expect(adapter.remove).not.toHaveBeenCalled();
  });

  it('removes a freshly confirmed orphan while preserving its files', async () => {
    const { service, adapter } = makeService();
    adapter.listOwned.mockResolvedValue({ supported: true, truncated: false, items: [owned(ORPHAN_HASH)] });

    await service.removeOrphan(4, ORPHAN_HASH, false);

    expect(adapter.remove).toHaveBeenCalledWith(ORPHAN_HASH, expect.anything(), { deleteFiles: false });
  });

  it('rejects malformed hashes before asking the client', async () => {
    const { service, adapter } = makeService();

    await expect(service.adopt(4, '../not-a-hash', 12)).rejects.toBeInstanceOf(BadRequestException);
    expect(adapter.listOwned).not.toHaveBeenCalled();
  });
});
