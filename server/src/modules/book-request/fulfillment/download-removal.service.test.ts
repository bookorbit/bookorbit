import type { BookRequestDownloadRow } from '../../../db/schema';
import { mkdir, mkdtemp, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { DownloadRemovalService } from './download-removal.service';

const INFO_HASH = 'c9e15763f722f23e98a29decdfae341b98d53056';

function download(overrides: Partial<BookRequestDownloadRow> = {}): BookRequestDownloadRow {
  return {
    id: 11,
    requestId: 7,
    downloadClientId: 4,
    clientKey: INFO_HASH,
    source: 'torrent_file',
    status: 'downloading',
    ...overrides,
  } as BookRequestDownloadRow;
}

async function makeService(options: { latest?: BookRequestDownloadRow | null; removeError?: Error; stageCapable?: boolean } = {}) {
  const appDataPath = await mkdtemp(join(tmpdir(), 'bookorbit-removal-'));
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
  const clients = {
    resolveConfig: vi.fn().mockResolvedValue({ id: 4, adapterType: options.stageCapable ? 'torbox' : 'qbittorrent' }),
    stagesLocally: vi.fn().mockResolvedValue(options.stageCapable ?? false),
  };
  const adapter = {
    remove: options.removeError ? vi.fn().mockRejectedValue(options.removeError) : vi.fn().mockResolvedValue(undefined),
  };
  if (options.stageCapable) (adapter as Record<string, unknown>).stage = vi.fn();
  const registry = { require: vi.fn().mockReturnValue(adapter) };
  const direct = {
    remove: options.removeError ? vi.fn().mockRejectedValue(options.removeError) : vi.fn().mockResolvedValue(undefined),
  };

  const service = new DownloadRemovalService(
    downloads as never,
    clients as never,
    registry as never,
    direct as never,
    { getOrThrow: vi.fn(() => appDataPath) } as never,
  );
  return { service, downloads, clients, adapter, registry, direct, appDataPath };
}

describe('DownloadRemovalService.removeLatestForRequest', () => {
  it('hands the torrent to the client and fails the attempt behind it', async () => {
    const { service, downloads, adapter } = await makeService();

    await expect(service.removeLatestForRequest(7, false, 'ann')).resolves.toEqual({ removed: true, error: null });

    expect(adapter.remove).toHaveBeenCalledWith(INFO_HASH, expect.anything(), { deleteFiles: false });
    expect(downloads.updateIf).toHaveBeenCalledWith(11, expect.arrayContaining(['downloading']), {
      status: 'failed',
      errorMessage: expect.stringContaining('ann'),
    });
  });

  it('leaves a finished attempt alone: the book is filed, the seed is not the request', async () => {
    const { service, downloads } = await makeService({ latest: download({ status: 'imported' }) });

    await expect(service.removeLatestForRequest(7, false, 'ann')).resolves.toEqual({ removed: true, error: null });

    // The conditional write is offered and refused, which is what leaves an imported row alone.
    expect(downloads.updateIf).toHaveBeenCalledWith(11, expect.not.arrayContaining(['imported']), expect.anything());
  });

  it('deletes partial direct-download staging when a request is cancelled', async () => {
    const staged = download({ source: 'direct_url', downloadClientId: null });
    const { service, direct, clients } = await makeService({ latest: staged });

    await service.removeLatestForRequest(7, false, 'ann');

    expect(direct.remove).toHaveBeenCalledWith(INFO_HASH, { deleteFiles: true });
    expect(clients.resolveConfig).not.toHaveBeenCalled();
  });

  it('reports nothing to remove for a request that was never grabbed', async () => {
    const { service, adapter } = await makeService({ latest: null });

    await expect(service.removeLatestForRequest(7, false, 'ann')).resolves.toEqual({ removed: false, error: null });
    expect(adapter.remove).not.toHaveBeenCalled();
  });

  it('reports a torrent the download client no longer owns rather than resolving a config for null', async () => {
    const { service, clients } = await makeService({ latest: download({ source: 'torrent_file', downloadClientId: null }) });

    await expect(service.removeLatestForRequest(7, false, 'ann')).resolves.toEqual({ removed: false, error: null });
    expect(clients.resolveConfig).not.toHaveBeenCalled();
  });

  /**
   * The caller is stopping or deleting the request itself. A client that is down must not be what
   * keeps a stuck request stuck, so the refusal comes back as a value and the caller decides.
   */
  it('carries a client refusal back instead of throwing', async () => {
    const { service } = await makeService({ removeError: new Error('connection refused') });

    await expect(service.removeLatestForRequest(7, false, 'ann')).resolves.toEqual({ removed: false, error: 'connection refused' });
  });

  /**
   * The caller is settling the request whatever the client says. An attempt left in flight is one
   * the poll loop keeps asking about and keeps writing progress back from, onto a row that has
   * already been cancelled.
   */
  it('takes the attempt out of the in-flight set even when the client refused the detach', async () => {
    const { service, downloads } = await makeService({ removeError: new Error('connection refused') });

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
    const { service, direct } = await makeService({ latest: staged });

    await service.cleanupStagedDirectDownload(staged);

    expect(direct.remove).toHaveBeenCalledWith(INFO_HASH, { deleteFiles: true });
  });

  it('does not remove torrent data during import', async () => {
    const torrent = download({ source: 'torrent_file', status: 'importing' });
    const { service, adapter, direct } = await makeService({ latest: torrent });

    await service.cleanupStagedDirectDownload(torrent);

    expect(adapter.remove).not.toHaveBeenCalled();
    expect(direct.remove).not.toHaveBeenCalled();
  });

  it('does not fail an imported book when staging cleanup fails', async () => {
    const staged = download({ source: 'direct_url', status: 'importing', downloadClientId: null });
    const { service } = await makeService({ latest: staged, removeError: new Error('busy') });

    await expect(service.cleanupStagedDirectDownload(staged)).resolves.toBeUndefined();
  });
});

describe('DownloadRemovalService.cleanupStagedClientDownload', () => {
  it('deletes staged cloud client files from the app data directory', async () => {
    const staged = download({ clientKey: INFO_HASH });
    const { service, appDataPath } = await makeService({ latest: staged, stageCapable: true });
    const stagedDir = join(appDataPath, 'client-downloads', 'torbox', INFO_HASH);
    await mkdir(stagedDir, { recursive: true });

    await service.cleanupStagedClientDownload(staged);

    await expect(readdir(stagedDir)).rejects.toThrow();
  });

  it('does nothing for direct downloads or adapters without staging', async () => {
    const direct = download({ source: 'direct_url', downloadClientId: null });
    const directContext = await makeService({ latest: direct });
    await directContext.service.cleanupStagedClientDownload(direct);
    expect(directContext.clients.resolveConfig).not.toHaveBeenCalled();

    const torrent = download();
    const torrentContext = await makeService({ latest: torrent });
    await torrentContext.service.cleanupStagedClientDownload(torrent);
    expect((torrentContext.adapter as Record<string, unknown>).stage).toBeUndefined();
  });
});

describe('DownloadRemovalService.detachAttempt', () => {
  it('always asks a staging-capable client to delete files', async () => {
    const staged = download();
    const { service, adapter } = await makeService({ latest: staged, stageCapable: true });

    await expect(service.detachAttempt(staged, false)).resolves.toBeNull();

    expect(adapter.remove).toHaveBeenCalledWith(INFO_HASH, expect.anything(), { deleteFiles: true });
  });
});
