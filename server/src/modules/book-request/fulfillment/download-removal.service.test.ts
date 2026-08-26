import type { BookRequestDownloadRow } from '../../../db/schema';
import { DownloadRemovalService } from './download-removal.service';

const INFO_HASH = 'c9e15763f722f23e98a29decdfae341b98d53056';

function download(overrides: Partial<BookRequestDownloadRow> = {}): BookRequestDownloadRow {
  return {
    id: 11,
    requestId: 7,
    downloadClientId: 4,
    clientHash: INFO_HASH,
    source: 'torrent_file',
    status: 'downloading',
    ...overrides,
  } as BookRequestDownloadRow;
}

function makeService(options: { latest?: BookRequestDownloadRow | null; removeError?: Error } = {}) {
  const row = options.latest === undefined ? download() : options.latest;
  const downloads = {
    findLatestForRequests: vi.fn().mockResolvedValue(row ? new Map([[7, { download: row, downloadClientName: 'qbit' }]]) : new Map()),
    findById: vi.fn().mockResolvedValue(row ?? undefined),
    update: vi.fn().mockResolvedValue(undefined),
    updateIf: vi
      .fn()
      .mockImplementation((id: number, expected: string[], patch: Record<string, unknown>) =>
        Promise.resolve(expected.includes(row?.status ?? '') ? { ...row, id, ...patch } : undefined),
      ),
  };
  const clients = { resolveConfig: vi.fn().mockResolvedValue({ id: 4, adapterType: 'qbittorrent' }) };
  const adapter = {
    remove: options.removeError ? vi.fn().mockRejectedValue(options.removeError) : vi.fn().mockResolvedValue(undefined),
  };
  const registry = { require: vi.fn().mockReturnValue(adapter) };
  const direct = {
    remove: options.removeError ? vi.fn().mockRejectedValue(options.removeError) : vi.fn().mockResolvedValue(undefined),
  };

  const service = new DownloadRemovalService(downloads as never, clients as never, registry as never, direct as never);
  return { service, downloads, clients, adapter, registry, direct };
}

describe('DownloadRemovalService.removeLatestForRequest', () => {
  it('hands the torrent to the client and fails the attempt behind it', async () => {
    const { service, downloads, adapter } = makeService();

    await expect(service.removeLatestForRequest(7, false, 'ann')).resolves.toEqual({ removed: true, error: null });

    expect(adapter.remove).toHaveBeenCalledWith(INFO_HASH, expect.anything(), { deleteFiles: false });
    expect(downloads.updateIf).toHaveBeenCalledWith(11, expect.arrayContaining(['downloading']), {
      status: 'failed',
      errorMessage: expect.stringContaining('ann'),
    });
  });

  it('leaves a finished attempt alone: the book is filed, the seed is not the request', async () => {
    const { service, downloads } = makeService({ latest: download({ status: 'imported' }) });

    await expect(service.removeLatestForRequest(7, false, 'ann')).resolves.toEqual({ removed: true, error: null });

    // The conditional write is offered and refused, which is what leaves an imported row alone.
    expect(downloads.updateIf).toHaveBeenCalledWith(11, expect.not.arrayContaining(['imported']), expect.anything());
  });

  it('deletes partial direct-download staging when a request is cancelled', async () => {
    const staged = download({ source: 'direct_url', downloadClientId: null });
    const { service, direct, clients } = makeService({ latest: staged });

    await service.removeLatestForRequest(7, false, 'ann');

    expect(direct.remove).toHaveBeenCalledWith(INFO_HASH, { deleteFiles: true });
    expect(clients.resolveConfig).not.toHaveBeenCalled();
  });

  it('reports nothing to remove for a request that was never grabbed', async () => {
    const { service, adapter } = makeService({ latest: null });

    await expect(service.removeLatestForRequest(7, false, 'ann')).resolves.toEqual({ removed: false, error: null });
    expect(adapter.remove).not.toHaveBeenCalled();
  });

  it('reports a torrent the download client no longer owns rather than resolving a config for null', async () => {
    const { service, clients } = makeService({ latest: download({ source: 'torrent_file', downloadClientId: null }) });

    await expect(service.removeLatestForRequest(7, false, 'ann')).resolves.toEqual({ removed: false, error: null });
    expect(clients.resolveConfig).not.toHaveBeenCalled();
  });

  /**
   * The caller is stopping or deleting the request itself. A client that is down must not be what
   * keeps a stuck request stuck, so the refusal comes back as a value and the caller decides.
   */
  it('carries a client refusal back instead of throwing', async () => {
    const { service } = makeService({ removeError: new Error('connection refused') });

    await expect(service.removeLatestForRequest(7, false, 'ann')).resolves.toEqual({ removed: false, error: 'connection refused' });
  });

  /**
   * The caller is settling the request whatever the client says. An attempt left in flight is one
   * the poll loop keeps asking about and keeps writing progress back from, onto a row that has
   * already been cancelled.
   */
  it('takes the attempt out of the in-flight set even when the client refused the detach', async () => {
    const { service, downloads } = makeService({ removeError: new Error('connection refused') });

    await service.removeLatestForRequest(7, false, 'ann');

    expect(downloads.updateIf).toHaveBeenCalledWith(11, expect.arrayContaining(['downloading']), {
      status: 'failed',
      errorMessage: expect.stringContaining('connection refused'),
    });
  });
});

describe('DownloadRemovalService.cleanupStagedDirectDownload', () => {
  it('deletes direct-download staging once the Book Dock owns the file', async () => {
    const staged = download({ source: 'direct_url', status: 'importing', downloadClientId: null });
    const { service, direct } = makeService({ latest: staged });

    await service.cleanupStagedDirectDownload(staged);

    expect(direct.remove).toHaveBeenCalledWith(INFO_HASH, { deleteFiles: true });
  });

  it('does not remove torrent data during import', async () => {
    const torrent = download({ source: 'torrent_file', status: 'importing' });
    const { service, adapter, direct } = makeService({ latest: torrent });

    await service.cleanupStagedDirectDownload(torrent);

    expect(adapter.remove).not.toHaveBeenCalled();
    expect(direct.remove).not.toHaveBeenCalled();
  });

  it('does not fail an imported book when staging cleanup fails', async () => {
    const staged = download({ source: 'direct_url', status: 'importing', downloadClientId: null });
    const { service } = makeService({ latest: staged, removeError: new Error('busy') });

    await expect(service.cleanupStagedDirectDownload(staged)).resolves.toBeUndefined();
  });
});
