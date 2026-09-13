import { BadRequestException } from '@nestjs/common';

vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<typeof import('undici')>()),
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
}));

vi.mock('dns/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('dns/promises')>()),
  lookup: vi.fn(() => Promise.resolve([{ address: '127.0.0.1', family: 4 }])),
}));

import type { ResolvedClientConfig } from '../download-client-adapter';
import { forgetDispatchers } from '../../../../common/utils/safe-fetch';
import { NzbgetAdapter } from './nzbget.adapter';

const CLIENT_KEY = 'a'.repeat(64);

function config(overrides: Partial<ResolvedClientConfig> = {}): ResolvedClientConfig {
  return {
    id: 9,
    name: 'local nzbget',
    adapterType: 'nzbget',
    baseUrl: 'http://127.0.0.1:6789',
    username: 'nzbget',
    password: 'password',
    category: 'bookorbit',
    allowPrivateAddress: true,
    settings: null,
    ...overrides,
  };
}

interface RpcCall {
  url: string;
  method: string;
  params: unknown[];
  authorization: string | null;
}

function mockRpc(results: Record<string, unknown>) {
  const calls: RpcCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: URL | string, init: RequestInit = {}) => {
      const body = JSON.parse(init.body as string) as { method: string; params: unknown[] };
      calls.push({
        url: url.toString(),
        method: body.method,
        params: body.params,
        authorization: new Headers(init.headers).get('authorization'),
      });
      return Promise.resolve(new Response(JSON.stringify({ result: results[body.method] ?? null, error: null })));
    }),
  );
  return calls;
}

describe('NzbgetAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    forgetDispatchers();
  });

  it('tests the JSON-RPC endpoint with Basic authentication', async () => {
    const calls = mockRpc({ version: '24.8' });

    await expect(new NzbgetAdapter().test(config())).resolves.toEqual({ success: true, version: '24.8' });
    expect(calls[0]).toMatchObject({ url: 'http://127.0.0.1:6789/jsonrpc', method: 'version' });
    expect(calls[0]?.authorization).toBe(`Basic ${Buffer.from('nzbget:password').toString('base64')}`);
  });

  it('uploads the NZB and stamps the stable ownership duplicate key', async () => {
    const calls = mockRpc({ listgroups: [], history: [], append: 42 });

    await expect(
      new NzbgetAdapter().add({ nzbFile: Buffer.from('<nzb />'), nzbFileName: '../Dune.nzb', clientKey: CLIENT_KEY }, config()),
    ).resolves.toEqual({ clientKey: CLIENT_KEY });

    const append = calls.find((call) => call.method === 'append');
    expect(append?.params).toEqual([
      'Dune.nzb',
      Buffer.from('<nzb />').toString('base64'),
      'bookorbit',
      0,
      false,
      false,
      `bookorbit:9:${CLIENT_KEY}`,
      0,
      'ALL',
      [],
    ]);
  });

  it('keeps the NZB extension when a supplied filename is truncated', async () => {
    const calls = mockRpc({ listgroups: [], history: [], append: 42 });

    await new NzbgetAdapter().add({ nzbFile: Buffer.from('<nzb />'), nzbFileName: `${'D'.repeat(600)}.nzb`, clientKey: CLIENT_KEY }, config());

    const filename = calls.find((call) => call.method === 'append')?.params[0];
    expect(filename).toHaveLength(500);
    expect(filename).toMatch(/\.nzb$/);
  });

  it('adopts an existing owned item instead of appending it again', async () => {
    const calls = mockRpc({ listgroups: [{ NZBID: 3, DupeKey: `bookorbit:9:${CLIENT_KEY}` }] });

    await new NzbgetAdapter().add({ nzbFile: Buffer.from('<nzb />'), clientKey: CLIENT_KEY }, config());

    expect(calls.some((call) => call.method === 'append')).toBe(false);
  });

  it('maps queue and successful history items into bounded download statuses', async () => {
    mockRpc({
      listgroups: [
        {
          NZBID: 3,
          NZBName: 'Dune',
          DupeKey: `bookorbit:9:${CLIENT_KEY}`,
          Status: 'DOWNLOADING',
          FileSizeHi: 0,
          FileSizeLo: 1000,
          RemainingSizeHi: 0,
          RemainingSizeLo: 250,
          DestDir: '/downloads/Dune',
        },
      ],
      history: [],
    });

    await expect(new NzbgetAdapter().status([CLIENT_KEY], config())).resolves.toEqual([
      expect.objectContaining({ clientKey: CLIENT_KEY, state: 'downloading', progressPercent: 75, downloadedBytes: 750, totalBytes: 1000 }),
    ]);
  });

  it('uses FinalDir for a completed history item', async () => {
    mockRpc({
      listgroups: [],
      history: [
        {
          NZBID: 4,
          DupeKey: `bookorbit:9:${CLIENT_KEY}`,
          Status: 'SUCCESS/ALL',
          FileSizeHi: 0,
          FileSizeLo: 1000,
          DownloadedSizeHi: 0,
          DownloadedSizeLo: 1000,
          DestDir: '/downloads/intermediate',
          FinalDir: '/downloads/final',
        },
      ],
    });

    await expect(new NzbgetAdapter().status([CLIENT_KEY], config())).resolves.toEqual([
      expect.objectContaining({ state: 'completed', progressPercent: 100, contentPath: '/downloads/final' }),
    ]);
  });

  it('reports completed history at integral 100 percent when NZBGet counters differ after repair', async () => {
    mockRpc({
      listgroups: [],
      history: [
        {
          NZBID: 4,
          DupeKey: `bookorbit:9:${CLIENT_KEY}`,
          Status: 'SUCCESS/PAR',
          FileSizeHi: 0,
          FileSizeLo: 1_344_342,
          DownloadedSizeHi: 0,
          DownloadedSizeLo: 274_691,
          DestDir: '/downloads/final',
        },
      ],
    });

    await expect(new NzbgetAdapter().status([CLIENT_KEY], config())).resolves.toEqual([
      expect.objectContaining({ state: 'completed', progressPercent: 100, downloadedBytes: 274_691, totalBytes: 1_344_342 }),
    ]);
  });

  it('rounds in-progress percentages to the database integer contract', async () => {
    mockRpc({
      listgroups: [
        {
          NZBID: 3,
          DupeKey: `bookorbit:9:${CLIENT_KEY}`,
          Status: 'DOWNLOADING',
          FileSizeHi: 0,
          FileSizeLo: 3,
          RemainingSizeHi: 0,
          RemainingSizeLo: 2,
        },
      ],
      history: [],
    });

    await expect(new NzbgetAdapter().status([CLIENT_KEY], config())).resolves.toEqual([
      expect.objectContaining({ state: 'downloading', progressPercent: 33 }),
    ]);
  });

  it('maps post-processing completion and warning or deleted history states explicitly', async () => {
    const queuedKey = 'b'.repeat(64);
    const failedKey = 'c'.repeat(64);
    mockRpc({
      listgroups: [{ NZBID: 3, DupeKey: `bookorbit:9:${queuedKey}`, Status: 'PP_FINISHED', DestDir: '/downloads/queued' }],
      history: [
        { NZBID: 4, DupeKey: `bookorbit:9:${CLIENT_KEY}`, Status: 'WARNING/SCRIPT', DestDir: '/downloads/warning' },
        { NZBID: 5, DupeKey: `bookorbit:9:${failedKey}`, Status: 'DELETED/MANUAL', DestDir: '/downloads/deleted' },
      ],
    });

    await expect(new NzbgetAdapter().status([CLIENT_KEY, queuedKey, failedKey], config())).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ clientKey: queuedKey, state: 'completed', contentPath: '/downloads/queued' }),
        expect.objectContaining({ clientKey: CLIENT_KEY, state: 'completed', contentPath: '/downloads/warning' }),
        expect.objectContaining({ clientKey: failedKey, state: 'failed', contentPath: null }),
      ]),
    );
  });

  it('combines unsigned high and low size words and clamps values beyond safe integers', async () => {
    mockRpc({
      listgroups: [
        {
          NZBID: 3,
          DupeKey: `bookorbit:9:${CLIENT_KEY}`,
          Status: 'DOWNLOADING',
          FileSizeHi: 0x20_0000,
          FileSizeLo: 0xffff_ffff,
          RemainingSizeHi: 0,
          RemainingSizeLo: 1,
        },
      ],
      history: [],
    });

    await expect(new NzbgetAdapter().status([CLIENT_KEY], config())).resolves.toEqual([
      expect.objectContaining({ totalBytes: Number.MAX_SAFE_INTEGER, downloadedBytes: Number.MAX_SAFE_INTEGER - 1, progressPercent: 100 }),
    ]);
  });

  it('lists only items carrying both BookOrbit ownership and the configured category', async () => {
    mockRpc({
      listgroups: [
        { NZBID: 1, NZBName: 'owned', Category: 'bookorbit', DupeKey: `bookorbit:9:${CLIENT_KEY}`, Status: 'QUEUED' },
        { NZBID: 2, NZBName: 'other category', Category: 'other', DupeKey: `bookorbit:9:${'b'.repeat(64)}`, Status: 'QUEUED' },
        { NZBID: 3, NZBName: 'other client', Category: 'bookorbit', DupeKey: `bookorbit:10:${'c'.repeat(64)}`, Status: 'QUEUED' },
        { NZBID: 4, NZBName: 'not owned', Category: 'bookorbit', DupeKey: 'another-app', Status: 'QUEUED' },
      ],
      history: [],
    });

    await expect(new NzbgetAdapter().listOwned(config())).resolves.toMatchObject({ supported: true, truncated: false, items: [{ name: 'owned' }] });
  });

  it('bounds owned reconciliation inventory and reports truncation', async () => {
    const queue = Array.from({ length: 1001 }, (_, index) => ({
      NZBID: index + 1,
      NZBName: `owned-${index}`,
      Category: 'bookorbit',
      DupeKey: `bookorbit:9:${index.toString(16).padStart(64, '0')}`,
      Status: 'QUEUED',
    }));
    mockRpc({ listgroups: queue, history: [] });

    await expect(new NzbgetAdapter().listOwned(config())).resolves.toMatchObject({ supported: true, truncated: true, items: { length: 1000 } });
  });

  it('removes a queue group by its NZBID', async () => {
    const calls = mockRpc({ listgroups: [{ NZBID: 3, DupeKey: `bookorbit:9:${CLIENT_KEY}` }], editqueue: true });

    await new NzbgetAdapter().remove(CLIENT_KEY, config(), { deleteFiles: true });

    expect(calls.find((call) => call.method === 'editqueue')?.params).toEqual(['GroupFinalDelete', '', [3]]);
  });

  it('keeps partial files when removing a queue group without file deletion', async () => {
    const calls = mockRpc({ listgroups: [{ NZBID: 3, DupeKey: `bookorbit:9:${CLIENT_KEY}` }], editqueue: true });

    await new NzbgetAdapter().remove(CLIENT_KEY, config(), { deleteFiles: false });

    expect(calls.find((call) => call.method === 'editqueue')?.params).toEqual(['GroupParkDelete', '', [3]]);
  });

  it.each([
    { deleteFiles: false, command: 'HistoryDelete' },
    { deleteFiles: true, command: 'HistoryFinalDelete' },
  ])('removes completed history by NZBID with $command', async ({ deleteFiles, command }) => {
    const calls = mockRpc({ listgroups: [], history: [{ NZBID: 4, DupeKey: `bookorbit:9:${CLIENT_KEY}` }], editqueue: true });

    await new NzbgetAdapter().remove(CLIENT_KEY, config(), { deleteFiles });
    expect(calls.find((call) => call.method === 'editqueue')?.params).toEqual([command, '', [4]]);
  });

  it('ignores history entries without BookOrbit ownership', async () => {
    const calls = mockRpc({ listgroups: [], history: [{ NZBID: 4, DupeKey: `bookorbit:9:${CLIENT_KEY}` }], editqueue: true });

    await new NzbgetAdapter().remove('b'.repeat(64), config(), { deleteFiles: false });
    expect(calls.some((call) => call.method === 'editqueue')).toBe(false);
  });

  it('rejects malformed JSON-RPC envelopes and invalid list results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{'))),
    );
    await expect(new NzbgetAdapter().status([CLIENT_KEY], config())).rejects.toBeInstanceOf(BadRequestException);

    mockRpc({ listgroups: { not: 'an array' } });
    await expect(new NzbgetAdapter().status([CLIENT_KEY], config())).rejects.toThrow('invalid listgroups result');
  });

  it('rejects a JSON-RPC error and an invalid client key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ result: null, error: { message: 'bad request' } })))),
    );
    await expect(new NzbgetAdapter().test(config())).resolves.toMatchObject({ success: false, error: expect.stringContaining('bad request') });
    await expect(new NzbgetAdapter().status(['not-a-key'], config())).rejects.toBeInstanceOf(BadRequestException);
  });
});
