import { BadRequestException, NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../../../common/types/request-user';
import type { BookRequestDownloadRow } from '../../../db/schema';
import { DownloadRemovalService } from './download-removal.service';
import { RequestSeedService } from './request-seed.service';

const INFO_HASH = 'c9e15763f722f23e98a29decdfae341b98d53056';

function user(): RequestUser {
  return { id: 1, username: 'ann', name: 'Ann', isSuperuser: true, permissions: [] } as unknown as RequestUser;
}

function download(overrides: Partial<BookRequestDownloadRow> = {}): BookRequestDownloadRow {
  return {
    id: 11,
    requestId: 7,
    downloadClientId: 4,
    clientHash: INFO_HASH,
    source: 'torrent_file',
    status: 'imported',
    ...overrides,
  } as BookRequestDownloadRow;
}

function makeService(
  options: {
    latest?: BookRequestDownloadRow | null;
    status?: Array<Record<string, unknown>>;
  } = {},
) {
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
  const requests = {
    findById: vi.fn().mockResolvedValue({ request: { id: 7 } }),
    update: vi.fn().mockResolvedValue(undefined),
    updateIf: vi.fn().mockResolvedValue({ id: 7 }),
  };
  const clients = { resolveConfig: vi.fn().mockResolvedValue({ id: 4, adapterType: 'qbittorrent' }) };
  const adapter = {
    status: vi.fn().mockResolvedValue(
      options.status ?? [
        {
          infoHash: INFO_HASH,
          seed: { seeding: true, ratio: 1.4, ratioGoal: 2, seedingTimeSeconds: 60, seedingTimeGoalMinutes: 4320, uploadedBytes: 900 },
        },
      ],
    ),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const registry = { require: vi.fn().mockReturnValue(adapter) };
  const bookRequests = { getOne: vi.fn().mockResolvedValue({ id: 7 }) };
  const gateway = { emitChanged: vi.fn() };

  // The real removal service, not a double: these tests are about what reaches the download
  // client, and a stubbed remover would assert only that the seed service called a mock.
  const removal = new DownloadRemovalService(downloads as never, clients as never, registry as never);

  const service = new RequestSeedService(
    downloads as never,
    requests as never,
    clients as never,
    registry as never,
    bookRequests as never,
    removal,
    gateway as never,
  );

  return { service, downloads, requests, clients, adapter, registry, bookRequests, removal, gateway };
}

describe('RequestSeedService.getSeedStatus', () => {
  it('reports what the client says about the torrent, goals included', async () => {
    const { service } = makeService();

    await expect(service.getSeedStatus(7)).resolves.toEqual({
      downloadId: 11,
      downloadClientId: 4,
      downloadClientName: 'qbit',
      clientHash: INFO_HASH,
      seeding: true,
      ratio: 1.4,
      ratioGoal: 2,
      seedingTimeSeconds: 60,
      seedingTimeGoalMinutes: 4320,
      uploadedBytes: 900,
    });
  });

  it('reports nothing for a request that was never grabbed', async () => {
    const { service, adapter } = makeService({ latest: null });

    await expect(service.getSeedStatus(7)).resolves.toBeNull();
    expect(adapter.status).not.toHaveBeenCalled();
  });

  it('404s a request that does not exist rather than reporting no seed', async () => {
    const { service, requests } = makeService({ latest: null });
    requests.findById.mockResolvedValue(undefined);

    await expect(service.getSeedStatus(7)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reports nothing once the client has forgotten the torrent', async () => {
    const { service } = makeService({ status: [] });
    await expect(service.getSeedStatus(7)).resolves.toBeNull();
  });

  it('does not ask an HTTP downloader for seed state', async () => {
    const { service, clients, adapter } = makeService({ latest: download({ source: 'direct_url' }) });

    await expect(service.getSeedStatus(7)).resolves.toBeNull();
    expect(clients.resolveConfig).not.toHaveBeenCalled();
    expect(adapter.status).not.toHaveBeenCalled();
  });

  /** An adapter with nothing to say about seeding must not read as a torrent seeding at zero. */
  it('reads a client that reports no seed detail as not seeding', async () => {
    const { service } = makeService({ status: [{ infoHash: INFO_HASH }] });
    await expect(service.getSeedStatus(7)).resolves.toMatchObject({ seeding: false, ratio: null });
  });
});

describe('RequestSeedService.removeFromClient', () => {
  it('leaves the files alone unless asked', async () => {
    const { service, adapter } = makeService();

    await service.removeFromClient(7, 11, false, user());

    expect(adapter.remove).toHaveBeenCalledWith(INFO_HASH, expect.anything(), { deleteFiles: false });
  });

  it('deletes the files when the approver asked for that', async () => {
    const { service, adapter } = makeService();

    await service.removeFromClient(7, 11, true, user());

    expect(adapter.remove).toHaveBeenCalledWith(INFO_HASH, expect.anything(), { deleteFiles: true });
  });

  it('leaves an already-imported request alone: the book is filed, the seed is not the request', async () => {
    const { service, downloads, requests } = makeService();

    await service.removeFromClient(7, 11, false, user());

    // The conditional write is offered and refused, which is what leaves an imported row alone.
    expect(downloads.updateIf).toHaveBeenCalledWith(11, expect.not.arrayContaining(['imported']), expect.anything());
    expect(requests.updateIf).not.toHaveBeenCalled();
  });

  /**
   * Nothing is going to finish a torrent that is no longer in the client, so this says so now
   * rather than leaving the request at "downloading" until the watchdog notices in twelve hours.
   */
  it('fails a request whose download was still running', async () => {
    const { service, downloads, requests, gateway } = makeService({ latest: download({ status: 'downloading' }) });

    await service.removeFromClient(7, 11, false, user());

    expect(downloads.updateIf).toHaveBeenCalledWith(11, expect.arrayContaining(['downloading']), {
      status: 'failed',
      errorMessage: expect.stringContaining('ann'),
    });
    expect(requests.updateIf).toHaveBeenCalledWith(7, expect.arrayContaining(['downloading']), {
      status: 'failed',
      statusReason: expect.stringContaining('ann'),
    });
    expect(gateway.emitChanged).toHaveBeenCalled();
  });

  it('refuses an attempt that belongs to another request', async () => {
    const { service } = makeService({ latest: download({ requestId: 99 }) });

    await expect(service.removeFromClient(7, 11, false, user())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses an attempt whose download client row is gone', async () => {
    const { service } = makeService({ latest: download({ downloadClientId: null }) });

    await expect(service.removeFromClient(7, 11, false, user())).rejects.toBeInstanceOf(BadRequestException);
  });
});
