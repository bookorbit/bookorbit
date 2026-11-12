import { BadRequestException } from '@nestjs/common';
import { FormData as UndiciFormData } from 'undici';

vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<typeof import('undici')>()),
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
}));

vi.mock('dns/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('dns/promises')>()),
  lookup: vi.fn(() => Promise.resolve([{ address: '127.0.0.1', family: 4 }])),
}));

import { forgetDispatchers } from '../../../../common/utils/safe-fetch';
import type { ResolvedClientConfig } from '../download-client-adapter';
import type { DownloadContentRemovalService } from '../download-content-removal.service';
import { SabnzbdAdapter } from './sabnzbd.adapter';

const CLIENT_KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);

function config(overrides: Partial<ResolvedClientConfig> = {}): ResolvedClientConfig {
  return {
    id: 9,
    name: 'local sabnzbd',
    adapterType: 'sabnzbd',
    baseUrl: 'http://127.0.0.1:8080/sabnzbd',
    username: null,
    password: 'api-secret',
    category: 'bookorbit',
    allowPrivateAddress: true,
    settings: null,
    ...overrides,
  };
}

interface ApiCall {
  url: URL;
  init: RequestInit;
}

function mockApi(responses: Record<string, unknown | ((url: URL, init: RequestInit) => unknown)>): ApiCall[] {
  const calls: ApiCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: URL | string, init: RequestInit = {}) => {
      const url = new URL(input.toString());
      calls.push({ url, init });
      const mode = url.searchParams.get('mode') ?? '';
      const response = responses[mode];
      const body = typeof response === 'function' ? response(url, init) : response;
      return Promise.resolve(new Response(JSON.stringify(body ?? {})));
    }),
  );
  return calls;
}

function contentRemoval(overrides: Partial<Record<'planFolder' | 'executeAfterRemoval', ReturnType<typeof vi.fn>>> = {}) {
  return {
    planFolder: vi.fn().mockResolvedValue({ files: [], topDirectory: null }),
    executeAfterRemoval: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DownloadContentRemovalService & { planFolder: ReturnType<typeof vi.fn>; executeAfterRemoval: ReturnType<typeof vi.fn> };
}

function emptyListings() {
  return { queue: { slots: [] }, history: { slots: [] } };
}

function configuredCategory() {
  return { config: { categories: [{ name: 'bookorbit' }] } };
}

describe('SabnzbdAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    forgetDispatchers();
  });

  it('tests the version endpoint with an API key and preserves a reverse-proxy subpath', async () => {
    const calls = mockApi({ version: { version: '4.5.3' }, get_config: configuredCategory() });

    await expect(new SabnzbdAdapter(contentRemoval()).test(config())).resolves.toEqual({ success: true, version: '4.5.3' });
    expect(calls[0]?.url.href).toBe('http://127.0.0.1:8080/sabnzbd/api?mode=version&output=json&apikey=api-secret');
  });

  it('requires an API key', async () => {
    mockApi({});

    await expect(new SabnzbdAdapter(contentRemoval()).test(config({ password: null }))).resolves.toEqual({
      success: false,
      error: 'SABnzbd needs an API key',
    });
  });

  it('reports a missing SABnzbd category during the connection test', async () => {
    mockApi({ version: { version: '4.5.3' }, get_config: { config: { categories: [{ name: '*' }] } } });

    await expect(new SabnzbdAdapter(contentRemoval()).test(config())).resolves.toEqual({
      success: false,
      error: 'SABnzbd category "bookorbit" does not exist',
    });
  });

  it('uploads an NZB with the configured category and stable ownership name', async () => {
    const calls = mockApi({
      queue: { queue: { slots: [] } },
      history: { history: { slots: [] } },
      addfile: { status: true, nzo_ids: ['SABnzbd_nzo_1'] },
      get_config: configuredCategory(),
    });

    await expect(
      new SabnzbdAdapter(contentRemoval()).add({ nzbFile: Buffer.from('<nzb />'), nzbFileName: '../Dune.nzb', clientKey: CLIENT_KEY }, config()),
    ).resolves.toEqual({ clientKey: CLIENT_KEY });

    const upload = calls.find((call) => call.url.searchParams.get('mode') === 'addfile');
    expect(upload?.url.searchParams.get('cat')).toBe('bookorbit');
    expect(upload?.url.searchParams.get('nzbname')).toBe(`bookorbit-9-${CLIENT_KEY}-Dune`);
    expect(upload?.init.method).toBe('POST');
    expect(upload?.init.body).toBeInstanceOf(UndiciFormData);
    const file = (upload?.init.body as unknown as FormData).get('name');
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe('Dune.nzb');
  });

  it('adopts an existing owned job instead of uploading it twice', async () => {
    const calls = mockApi({
      queue: { queue: { slots: [{ nzo_id: 'SABnzbd_nzo_1', filename: `bookorbit-9-${CLIENT_KEY}-Dune`, cat: 'bookorbit' }] } },
      history: { history: { slots: [] } },
      get_config: configuredCategory(),
    });

    await new SabnzbdAdapter(contentRemoval()).add({ nzbFile: Buffer.from('<nzb />'), clientKey: CLIENT_KEY }, config());

    expect(calls.some((call) => call.url.searchParams.get('mode') === 'addfile')).toBe(false);
  });

  it('re-uploads rather than adopting a failed history entry for the same release', async () => {
    const calls = mockApi({
      queue: { queue: { slots: [] } },
      history: { history: { slots: [{ nzo_id: 'SABnzbd_nzo_1', name: `bookorbit-9-${CLIENT_KEY}-Dune`, category: 'bookorbit', status: 'Failed' }] } },
      get_config: configuredCategory(),
      addfile: { status: true, nzo_ids: ['SABnzbd_nzo_2'] },
    });

    await new SabnzbdAdapter(contentRemoval()).add({ nzbFile: Buffer.from('<nzb />'), clientKey: CLIENT_KEY }, config());

    expect(calls.some((call) => call.url.searchParams.get('mode') === 'addfile')).toBe(true);
  });

  it('maps queue progress and completed history storage into download statuses', async () => {
    mockApi({
      queue: {
        queue: {
          slots: [
            {
              nzo_id: 'SABnzbd_nzo_1',
              filename: `bookorbit-9-${CLIENT_KEY}-Dune`,
              cat: 'bookorbit',
              status: 'Downloading',
              bytes: '1000',
              bytesleft: '250',
              percentage: '75.4',
            },
          ],
        },
      },
      history: {
        history: {
          slots: [
            {
              nzo_id: 'SABnzbd_nzo_2',
              name: `bookorbit-9-${OTHER_KEY}-Foundation`,
              category: 'bookorbit',
              status: 'Completed',
              bytes: 2048,
              storage: '/downloads/Foundation',
            },
          ],
        },
      },
    });

    await expect(new SabnzbdAdapter(contentRemoval()).status([CLIENT_KEY, OTHER_KEY], config())).resolves.toEqual([
      expect.objectContaining({ clientKey: CLIENT_KEY, state: 'downloading', progressPercent: 75, downloadedBytes: 750, totalBytes: 1000 }),
      expect.objectContaining({
        clientKey: OTHER_KEY,
        state: 'completed',
        progressPercent: 100,
        downloadedBytes: 2048,
        contentPath: '/downloads/Foundation',
      }),
    ]);
  });

  it('keeps post-processing jobs in flight and exposes failed history details', async () => {
    mockApi({
      queue: {
        queue: {
          slots: [{ nzo_id: 'SABnzbd_nzo_1', filename: `bookorbit-9-${CLIENT_KEY}-Dune`, cat: 'bookorbit', status: 'Extracting', percentage: 100 }],
        },
      },
      history: {
        history: {
          slots: [
            {
              nzo_id: 'SABnzbd_nzo_2',
              name: `bookorbit-9-${OTHER_KEY}-Foundation`,
              category: 'bookorbit',
              status: 'Failed',
              fail_message: 'Repair failed',
            },
          ],
        },
      },
    });

    await expect(new SabnzbdAdapter(contentRemoval()).status([CLIENT_KEY, OTHER_KEY], config())).resolves.toEqual([
      expect.objectContaining({ clientKey: CLIENT_KEY, state: 'downloading', progressPercent: 100 }),
      expect.objectContaining({ clientKey: OTHER_KEY, state: 'failed', errorMessage: 'Repair failed', contentPath: null }),
    ]);
  });

  it('lists only jobs with both the BookOrbit marker and configured category', async () => {
    mockApi({
      queue: {
        queue: {
          slots: [
            { nzo_id: 'owned', filename: `bookorbit-9-${CLIENT_KEY}-Dune`, cat: 'bookorbit', status: 'Queued' },
            { nzo_id: 'other-category', filename: `bookorbit-9-${OTHER_KEY}-Other`, cat: 'other', status: 'Queued' },
            { nzo_id: 'unowned', filename: 'ordinary job', cat: 'bookorbit', status: 'Queued' },
          ],
        },
      },
      history: { history: { slots: [] } },
    });

    await expect(new SabnzbdAdapter(contentRemoval()).listOwned(config())).resolves.toEqual({
      supported: true,
      truncated: false,
      items: [expect.objectContaining({ clientKey: CLIENT_KEY, name: 'Dune', state: 'queued' })],
    });
  });

  it.each([
    ['queue', { filename: `bookorbit-9-${CLIENT_KEY}-Dune`, cat: 'bookorbit', status: 'Downloading' }],
    ['history', { name: `bookorbit-9-${CLIENT_KEY}-Dune`, category: 'bookorbit', status: 'Completed' }],
  ] as const)('removes an owned %s job with the requested file policy', async (location, slot) => {
    const calls = mockApi({
      queue: (url) =>
        url.searchParams.get('name') === 'delete'
          ? { status: true }
          : { queue: { slots: location === 'queue' ? [{ nzo_id: 'SABnzbd_nzo_1', ...slot }] : [] } },
      history: (url) =>
        url.searchParams.get('name') === 'delete'
          ? { status: true }
          : { history: { slots: location === 'history' ? [{ nzo_id: 'SABnzbd_nzo_1', ...slot }] : [] } },
    });

    await new SabnzbdAdapter(contentRemoval()).remove(CLIENT_KEY, config(), { deleteFiles: true });

    const removal = calls.find((call) => call.url.searchParams.get('name') === 'delete');
    expect(removal?.url.searchParams.get('mode')).toBe(location);
    expect(removal?.url.searchParams.get('value')).toBe('SABnzbd_nzo_1');
    expect(removal?.url.searchParams.get('del_files')).toBe('1');
    expect(removal?.url.searchParams.get('archive')).toBe(location === 'history' ? '0' : null);
  });

  describe('deleting a completed job', () => {
    const completedSlot = (storage: string) => ({
      nzo_id: 'SABnzbd_nzo_1',
      name: `bookorbit-9-${CLIENT_KEY}-Dune`,
      category: 'bookorbit',
      status: 'Completed',
      storage,
    });

    function mockHistory(slot: Record<string, unknown>, order: string[]) {
      return mockApi({
        queue: { queue: { slots: [] } },
        history: (url) => {
          if (url.searchParams.get('name') !== 'delete') return { history: { slots: [slot] } };
          order.push('client');
          return { status: true };
        },
      });
    }

    it('plans the folder before SABnzbd lets go of the job and deletes it afterwards', async () => {
      const order: string[] = [];
      const plan = { files: ['/library/downloads/x/Dune.epub'], topDirectory: '/library/downloads/x' };
      const removal = contentRemoval({
        planFolder: vi.fn(() => {
          order.push('plan');
          return Promise.resolve(plan);
        }),
        executeAfterRemoval: vi.fn(() => {
          order.push('execute');
          return Promise.resolve();
        }),
      });
      const storage = `/downloads/complete/bookorbit/bookorbit-9-${CLIENT_KEY}-Dune`;
      const calls = mockHistory(completedSlot(storage), order);

      await new SabnzbdAdapter(removal).remove(CLIENT_KEY, config(), { deleteFiles: true });

      expect(order).toEqual(['plan', 'client', 'execute']);
      expect(removal.planFolder).toHaveBeenCalledWith(9, storage);
      expect(removal.executeAfterRemoval).toHaveBeenCalledWith(plan, { clientId: 9, clientKey: CLIENT_KEY, label: 'SABnzbd' });
      const deletion = calls.find((call) => call.url.searchParams.get('name') === 'delete');
      expect(deletion?.url.searchParams.get('del_files')).toBe('1');
      expect(deletion?.url.searchParams.get('archive')).toBe('0');
    });

    it('accepts the numbered folder SABnzbd makes when the name is already taken', async () => {
      const removal = contentRemoval();
      const storage = `/downloads/complete/bookorbit/bookorbit-9-${CLIENT_KEY}-Dune.1`;
      mockHistory(completedSlot(storage), []);

      await new SabnzbdAdapter(removal).remove(CLIENT_KEY, config(), { deleteFiles: true });

      expect(removal.planFolder).toHaveBeenCalledWith(9, storage);
    });

    it("refuses a folder that is not the job's own, and leaves the job in SABnzbd", async () => {
      const order: string[] = [];
      const removal = contentRemoval();
      mockHistory(completedSlot('/downloads/complete/books/Frank Herbert'), order);

      await expect(new SabnzbdAdapter(removal).remove(CLIENT_KEY, config(), { deleteFiles: true })).rejects.toThrow('not its own');

      expect(order).toEqual([]);
      expect(removal.planFolder).not.toHaveBeenCalled();
    });

    it('leaves the job in SABnzbd when the folder cannot be deleted', async () => {
      const order: string[] = [];
      const removal = contentRemoval({ planFolder: vi.fn().mockRejectedValue(new BadRequestException('Nothing was removed.')) });
      mockHistory(completedSlot(`/downloads/complete/bookorbit/bookorbit-9-${CLIENT_KEY}-Dune`), order);

      await expect(new SabnzbdAdapter(removal).remove(CLIENT_KEY, config(), { deleteFiles: true })).rejects.toThrow('Nothing was removed.');

      expect(order).toEqual([]);
    });

    it('keeps the folder when the files are kept', async () => {
      const order: string[] = [];
      const removal = contentRemoval();
      mockHistory(completedSlot(`/downloads/complete/bookorbit/bookorbit-9-${CLIENT_KEY}-Dune`), order);

      await new SabnzbdAdapter(removal).remove(CLIENT_KEY, config(), { deleteFiles: false });

      expect(order).toEqual(['client']);
      expect(removal.planFolder).not.toHaveBeenCalled();
      expect(removal.executeAfterRemoval).not.toHaveBeenCalled();
    });

    it('leaves a failed job to del_files, which already clears it', async () => {
      const removal = contentRemoval();
      mockHistory({ ...completedSlot(`/downloads/complete/bookorbit/bookorbit-9-${CLIENT_KEY}-Dune`), status: 'Failed' }, []);

      await new SabnzbdAdapter(removal).remove(CLIENT_KEY, config(), { deleteFiles: true });

      expect(removal.planFolder).not.toHaveBeenCalled();
    });
  });

  it('turns an API rejection into a useful authentication failure', async () => {
    mockApi({ version: { status: false, error: 'API Key Incorrect' } });

    await expect(new SabnzbdAdapter(contentRemoval()).test(config())).resolves.toEqual({ success: false, error: 'SABnzbd rejected the API key' });
  });

  it('does not depend on SABnzbd queue and history search semantics', async () => {
    const calls = mockApi({ queue: { queue: { slots: [] } }, history: { history: { slots: [] } } });

    await new SabnzbdAdapter(contentRemoval()).listOwned(config());

    const inventoryCalls = calls.filter((call) => ['queue', 'history'].includes(call.url.searchParams.get('mode') ?? ''));
    expect(inventoryCalls.every((call) => !call.url.searchParams.has('search'))).toBe(true);
  });

  it('rejects invalid client keys before making a request', async () => {
    mockApi(emptyListings());

    await expect(new SabnzbdAdapter(contentRemoval()).status(['not-a-key'], config())).rejects.toBeInstanceOf(BadRequestException);
  });
});
