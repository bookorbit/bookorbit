import { Test, type TestingModule } from '@nestjs/testing';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { BookRequestDownloadRow } from '../src/db/schema';
import { BookRequestGateway } from '../src/modules/book-request/book-request.gateway';
import { BookRequestRepository } from '../src/modules/book-request/book-request.repository';
import { QbittorrentAdapter } from '../src/modules/book-request/download-clients/adapters/qbittorrent.adapter';
import type { ResolvedClientConfig } from '../src/modules/book-request/download-clients/download-client-adapter';
import { DownloadClientConfigService } from '../src/modules/book-request/download-clients/download-client-config.service';
import { DownloadClientRegistry } from '../src/modules/book-request/download-clients/download-client-registry';
import { BookRequestDownloadRepository } from '../src/modules/book-request/fulfillment/book-request-download.repository';
import { DirectDownloadService } from '../src/modules/book-request/fulfillment/direct-download.service';
import { DownloadMonitorService } from '../src/modules/book-request/fulfillment/download-monitor.service';
import { RequestFulfillmentService } from '../src/modules/book-request/fulfillment/request-fulfillment.service';
import { RequestImportService } from '../src/modules/book-request/fulfillment/request-import.service';
import { infoHashFromMagnet } from '../src/modules/book-request/fulfillment/torrent.utils';

// Opt-in regression for issue 1318 against the pinned daemon that reproduced the bug.
// BO_REPRO_1318=1 pnpm --filter server test test/qbittorrent-hybrid.repro.test.ts
const IMAGE = 'lscr.io/linuxserver/qbittorrent:5.2.3@sha256:8d48fa8c619caadfb103f04efea8747e2a2762d6c7551690919cffb987e61cee';
const exec = promisify(execFile);
const CONTENT = Buffer.from('BookOrbit issue 1318 synthetic public test content.\n');
const FILE_NAME = 'issue-1318.txt';

type Bencoded = number | Buffer | { [key: string]: Bencoded };

function bencode(value: Bencoded): Buffer {
  if (typeof value === 'number') return Buffer.from(`i${value}e`);
  if (Buffer.isBuffer(value)) return Buffer.concat([Buffer.from(`${value.length}:`), value]);
  return Buffer.concat([
    Buffer.from('d'),
    ...Object.keys(value)
      .sort()
      .flatMap((key) => [bencode(Buffer.from(key)), bencode(value[key])]),
    Buffer.from('e'),
  ]);
}

const info = bencode({
  'file tree': { [FILE_NAME]: { '': { length: CONTENT.length, 'pieces root': createHash('sha256').update(CONTENT).digest() } } },
  length: CONTENT.length,
  'meta version': 2,
  name: Buffer.from(FILE_NAME),
  'piece length': 16384,
  pieces: createHash('sha1').update(CONTENT).digest(),
});
const V1 = createHash('sha1').update(info).digest('hex');
const V2 = createHash('sha256').update(info).digest('hex');
const PRIMARY = V2.slice(0, 40);
const MAGNET = `magnet:?xt=urn:btih:${V1}&xt=urn:btmh:1220${V2}`;

describe.skipIf(process.env.BO_REPRO_1318 !== '1')('issue 1318 against real qBittorrent 5.2.3', () => {
  let root: string;
  let containerId: string;
  let config: ResolvedClientConfig;
  let adapter: QbittorrentAdapter;
  let module: TestingModule;

  async function api(path: string, body?: URLSearchParams | FormData): Promise<Response> {
    const result = await fetch(`${config.baseUrl}/api/v2/${path}`, {
      method: body ? 'POST' : 'GET',
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!result.ok) throw new Error(`Fixture API ${path.split('?')[0]} returned ${result.status}`);
    return result;
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'bo-1318-'));
    await mkdir(join(root, 'config', 'qBittorrent'), { recursive: true });
    await mkdir(join(root, 'downloads'));
    await writeFile(join(root, 'downloads', FILE_NAME), CONTENT);
    await writeFile(
      join(root, 'config', 'qBittorrent', 'qBittorrent.conf'),
      [
        '[LegalNotice]',
        'Accepted=true',
        '[Preferences]',
        'WebUI\\AuthSubnetWhitelistEnabled=true',
        'WebUI\\AuthSubnetWhitelist=0.0.0.0/0',
        'WebUI\\CSRFProtection=false',
        'WebUI\\HostHeaderValidation=false',
        '[BitTorrent]',
        'Session\\DHTEnabled=false',
        'Session\\LSDEnabled=false',
        'Session\\PeXEnabled=false',
        '',
      ].join('\n'),
    );
    const started = await exec(
      'docker',
      ['run', '-d', '--rm', '-p', '127.0.0.1::8080', '-v', `${root}/config:/config`, '-v', `${root}/downloads:/downloads`, IMAGE],
      { timeout: 180_000 },
    );
    containerId = started.stdout.trim();
    const port = (await exec('docker', ['port', containerId, '8080'])).stdout.trim().split(':').at(-1);
    config = {
      id: 1,
      name: 'issue 1318 isolated fixture',
      adapterType: 'qbittorrent',
      baseUrl: `http://127.0.0.1:${port}`,
      username: null,
      password: null,
      category: 'bookorbit',
      allowPrivateAddress: true,
      settings: null,
    };
    module = await Test.createTestingModule({ providers: [QbittorrentAdapter] }).compile();
    adapter = module.get(QbittorrentAdapter);
    await vi.waitFor(async () => expect(await (await api('app/version')).text()).toBe('v5.2.3'), { timeout: 30_000, interval: 250 });

    expect(infoHashFromMagnet(MAGNET)).toBe(V1);
    expect(await adapter.add({ magnet: MAGNET, infoHash: infoHashFromMagnet(MAGNET) }, config)).toEqual({ clientHash: V1 });
    await vi.waitFor(
      async () => {
        expect(await (await api(`torrents/info?hashes=${PRIMARY}`)).json()).toEqual([
          expect.objectContaining({ hash: PRIMARY, infohash_v1: V1, infohash_v2: V2 }),
        ]);
      },
      { timeout: 10_000, interval: 100 },
    );

    // Supply the same metadata and preseeded bytes without depending on trackers or peers.
    await api('torrents/delete', new URLSearchParams({ hashes: PRIMARY, deleteFiles: 'false' }));
    await vi.waitFor(async () => expect(await (await api('torrents/info')).json()).toEqual([]), { timeout: 10_000, interval: 100 });
    const form = new FormData();
    form.append('torrents', new Blob([new Uint8Array(Buffer.concat([Buffer.from('d4:info'), info, Buffer.from('e')]))]), 'hybrid.torrent');
    form.append('category', config.category);
    form.append('savepath', '/downloads');
    await api('torrents/add', form);
    await vi.waitFor(
      async () => {
        expect(await (await api('torrents/info?category=bookorbit')).json()).toEqual([
          expect.objectContaining({ hash: PRIMARY, infohash_v1: V1, infohash_v2: V2, progress: 1, state: 'stalledUP' }),
        ]);
      },
      { timeout: 30_000, interval: 100 },
    );
  }, 240_000);

  afterAll(async () => {
    try {
      await module?.close();
    } finally {
      if (containerId) await exec('docker', ['rm', '-f', containerId]);
      if (root) await rm(root, { recursive: true, force: true });
    }
  });

  it('has verified complete bytes, but the real API cannot find the torrent by v1', async () => {
    expect(await readFile(join(root, 'downloads', FILE_NAME))).toEqual(CONTENT);
    expect(await (await api(`torrents/info?hashes=${V1}`)).json()).toEqual([]);
    expect(await (await api(`torrents/info?hashes=${PRIMARY}`)).json()).toEqual([
      expect.objectContaining({ hash: PRIMARY, infohash_v1: V1, infohash_v2: V2, progress: 1, state: 'stalledUP' }),
    ]);
  });

  it('finds completion under both the stored hash and the primary hash', async () => {
    expect(await adapter.status([V1], config)).toEqual([expect.objectContaining({ infoHash: V1, state: 'completed', progressPercent: 100 })]);
    expect(await adapter.status([PRIMARY], config)).toEqual([
      expect.objectContaining({ infoHash: PRIMARY, state: 'completed', progressPercent: 100 }),
    ]);
  });

  it('schedules import beyond the old 120-second failure boundary', async () => {
    const grabbedAt = new Date('2026-01-01T00:00:00Z');
    const row = {
      id: 11,
      requestId: 7,
      downloadClientId: config.id,
      clientHash: V1,
      source: 'magnet',
      status: 'downloading',
      bookDockFileId: null,
      downloadedBytes: 0,
      grabbedAt,
      createdAt: grabbedAt,
    } as BookRequestDownloadRow;
    const failDownload = vi.fn().mockResolvedValue(undefined);
    const importDownload = vi.fn().mockResolvedValue(true);
    const monitorModule = await Test.createTestingModule({
      providers: [
        DownloadMonitorService,
        {
          provide: BookRequestDownloadRepository,
          useValue: {
            findActive: vi.fn().mockImplementation(() => Promise.resolve(row.status === 'downloading' ? [row] : [])),
            findCompletedAwaitingImport: vi.fn().mockResolvedValue([]),
            findById: vi.fn().mockImplementation(() => Promise.resolve(row)),
            updateIf: vi
              .fn()
              .mockImplementation((_id: number, _expected: unknown, patch: Partial<BookRequestDownloadRow>) =>
                Promise.resolve(Object.assign(row, patch)),
              ),
          },
        },
        { provide: BookRequestRepository, useValue: { findRequestViewerIds: vi.fn().mockResolvedValue(new Map()) } },
        { provide: DownloadClientConfigService, useValue: { resolveConfig: vi.fn().mockResolvedValue(config) } },
        { provide: DownloadClientRegistry, useValue: { require: vi.fn().mockReturnValue(adapter) } },
        { provide: DirectDownloadService, useValue: {} },
        { provide: RequestImportService, useValue: { importDownload } },
        { provide: RequestFulfillmentService, useValue: { failDownload } },
        { provide: BookRequestGateway, useValue: { emitProgress: vi.fn() } },
      ],
    }).compile();
    const monitor = monitorModule.get(DownloadMonitorService);
    const now = vi.spyOn(Date, 'now');
    try {
      now.mockReturnValue(grabbedAt.getTime() + 120_000);
      await monitor.tick();
      await monitor.whenPollsSettle();
      await vi.waitFor(() => expect(importDownload).toHaveBeenCalledExactlyOnceWith(row));
      expect(row).toMatchObject({ status: 'completed', progressPercent: 100, contentPath: `/downloads/${FILE_NAME}` });
      now.mockReturnValue(grabbedAt.getTime() + 125_000);
      await monitor.tick();
      await monitor.whenPollsSettle();
      expect(failDownload).not.toHaveBeenCalled();
      expect(importDownload).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
      await monitorModule.close();
    }
  });

  it('adopts a retry after qBittorrent rejects the duplicate with 409', async () => {
    await expect(adapter.add({ magnet: MAGNET, infoHash: V1 }, config)).resolves.toEqual({ clientHash: V1 });
    expect(await adapter.status([PRIMARY], config)).toEqual([expect.objectContaining({ state: 'completed', progressPercent: 100 })]);
  });
  it('lists the hybrid under the tracked v1 identity and removes it without deleting its file', async () => {
    expect((await adapter.listOwned(config)).items).toEqual([expect.objectContaining({ infoHash: V1, state: 'completed' })]);
    await adapter.remove(V1, config, { deleteFiles: false });
    await vi.waitFor(async () => expect(await (await api('torrents/info')).json()).toEqual([]), { timeout: 10_000, interval: 100 });
    expect(await readFile(join(root, 'downloads', FILE_NAME))).toEqual(CONTENT);
  });
});
