import { Test, type TestingModule } from '@nestjs/testing';
import { DEFAULT_INDEXER_CATEGORIES } from '@bookorbit/types';

vi.mock('../../../../common/utils/safe-fetch', () => ({ safeFetch: vi.fn() }));
vi.mock('node:dns/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:dns/promises')>()),
  lookup: vi.fn(() => Promise.resolve([{ address: '93.184.216.34', family: 4 }])),
}));

import { safeFetch } from '../../../../common/utils/safe-fetch';
import { IndexerRetryExhaustedException, type ReleaseCandidate, type ResolvedIndexerConfig } from '../indexer-adapter';
import { NewznabAdapter } from './newznab.adapter';

const NOW = new Date('2026-10-12T12:00:00Z');
const NZB = Buffer.from('<?xml version="1.0"?><nzb xmlns="http://www.newzbin.com/DTD/2003/nzb"><file /></nzb>');
const FEED =
  '<rss><channel><item><title>Dune EPUB</title><guid>release-1</guid><link>https://indexer.example.test/get/1</link></item></channel></rss>';
const MODES = ['nzb', 'search'] as const;
type Mode = (typeof MODES)[number];
const fetchMock = vi.mocked(safeFetch);

const CONFIG: ResolvedIndexerConfig = {
  id: 7,
  managerId: null,
  managerPriority: null,
  name: 'fixture indexer',
  color: null,
  adapterType: 'newznab',
  baseUrl: 'https://indexer.example.test',
  credential: 'fixture-key',
  credentialError: null,
  allowPrivateAddress: false,
  applyTrackerSeedGoals: true,
  seedRatioGoal: null,
  seedTimeMinutes: null,
  categories: DEFAULT_INDEXER_CATEGORIES.newznab,
  disabledMediaKinds: [],
  isbnSearchDisabled: false,
  settings: null,
  networkProfile: null,
  perIndexerTimeoutSeconds: 20,
  overallSearchBudgetSeconds: null,
  autoExpandCategories: false,
};
const RELEASE: ReleaseCandidate = {
  indexerId: 7,
  guid: 'release-1',
  title: 'Dune EPUB',
  downloadUrl: 'https://indexer.example.test/get/1',
  sizeBytes: null,
  seeders: null,
  leechers: null,
};

function throttled(header: string | null = '5'): Response {
  return new Response('Rate limited', { status: 429, headers: header === null ? {} : { 'Retry-After': header } });
}

describe('NewznabAdapter bounded rate-limit retries', () => {
  let module: TestingModule;
  let adapter: NewznabAdapter;
  let controller: AbortController;

  beforeEach(async () => {
    fetchMock.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    controller = new AbortController();
    module = await Test.createTestingModule({ providers: [NewznabAdapter] }).compile();
    adapter = module.get(NewznabAdapter);
  });

  afterEach(async () => {
    await module.close();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function invoke(mode: Mode) {
    return mode === 'nzb'
      ? adapter.fetchNzbFile(RELEASE, CONFIG)
      : adapter.search(
          {
            title: 'Dune',
            author: null,
            isbn13: null,
            isbn13s: [],
            mediaKind: 'ebook',
            language: null,
            limit: 50,
          },
          CONFIG,
          controller.signal,
        );
  }

  function success(mode: Mode): Response {
    return new Response(mode === 'nzb' ? NZB : FEED);
  }

  function expected(mode: Mode) {
    return mode === 'nzb' ? NZB : [expect.objectContaining({ guid: 'release-1' })];
  }

  it.each(MODES)('%s waits for Retry-After and releases the 429 body before retrying the same URL', async (mode) => {
    const response = throttled();
    const cancel = vi.spyOn(response.body!, 'cancel');
    fetchMock.mockResolvedValueOnce(response).mockResolvedValueOnce(success(mode));
    const outcome = expect(invoke(mode)).resolves.toEqual(expected(mode));

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]).toEqual(fetchMock.mock.calls[0]);
  });

  const headerCases = [
    { label: 'missing', header: null, delay: 1000 },
    { label: 'empty', header: '', delay: 1000 },
    { label: 'malformed', header: 'tomorrow', delay: 1000 },
    { label: 'negative', header: '-1', delay: 1000 },
    { label: 'fractional', header: '1.5', delay: 1000 },
    { label: 'infinite', header: 'Infinity', delay: 1000 },
    { label: 'zero', header: '0', delay: 0 },
    { label: 'leading zeroes', header: '0002', delay: 2000 },
    { label: 'seconds', header: '5', delay: 5000 },
    { label: 'capped seconds', header: '600', delay: 10_000 },
    { label: 'overflowing seconds', header: '9'.repeat(400), delay: 10_000 },
    { label: 'HTTP date', header: 'Mon, 12 Oct 2026 12:00:05 GMT', delay: 5000 },
    { label: 'RFC850 date', header: 'Monday, 12-Oct-26 12:00:05 GMT', delay: 5000 },
    { label: 'asctime date', header: 'Mon Oct 12 12:00:05 2026', delay: 5000 },
    { label: 'past date', header: 'Mon, 12 Oct 2026 11:59:55 GMT', delay: 0 },
    { label: 'capped date', header: 'Mon, 12 Oct 2026 12:10:00 GMT', delay: 10_000 },
    { label: 'invalid HTTP date', header: 'Mon, 12 Bad 2026 12:00:05 GMT', delay: 1000 },
  ];

  it.each(MODES.flatMap((mode) => headerCases.map((entry) => ({ mode, ...entry }))))(
    '$mode handles $label Retry-After with a bounded delay',
    async ({ mode, header, delay }) => {
      const times: number[] = [];
      fetchMock.mockImplementationOnce(() => {
        times.push(Date.now());
        return Promise.resolve(throttled(header));
      });
      fetchMock.mockImplementationOnce(() => {
        times.push(Date.now());
        return Promise.resolve(success(mode));
      });
      const outcome = expect(invoke(mode)).resolves.toEqual(expected(mode));
      await vi.advanceTimersByTimeAsync(delay);
      await outcome;
      expect(times).toEqual([NOW.getTime(), NOW.getTime() + delay]);
    },
  );

  it.each(MODES)('%s recovers on the second retry using the latest Retry-After', async (mode) => {
    fetchMock.mockResolvedValueOnce(throttled('5')).mockResolvedValueOnce(throttled('2')).mockResolvedValueOnce(success(mode));
    const outcome = expect(invoke(mode)).resolves.toEqual(expected(mode));
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each(MODES)('%s exhausts after three requests and cancels every discarded response', async (mode) => {
    const responses = [throttled(), throttled(), throttled()];
    const cancellations = responses.map((response) => vi.spyOn(response.body!, 'cancel'));
    responses.forEach((response) => fetchMock.mockResolvedValueOnce(response));
    const outcome = expect(invoke(mode)).rejects.toBeInstanceOf(IndexerRetryExhaustedException);
    await vi.advanceTimersByTimeAsync(10_000);
    await outcome;
    cancellations.forEach((cancel) => expect(cancel).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each(MODES)('%s shares its retry budget across redirects', async (mode) => {
    fetchMock
      .mockResolvedValueOnce(throttled('0'))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/second' } }))
      .mockResolvedValueOnce(throttled('0'))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/third' } }))
      .mockResolvedValueOnce(throttled('0'));
    const outcome = expect(invoke(mode)).rejects.toMatchObject({ failure: 'throttled' });
    await vi.runAllTimersAsync();
    await outcome;
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(
      mode === 'nzb' ? ['/get/1', '/get/1', '/second', '/second', '/third'] : ['/api', '/api', '/second', '/second', '/third'],
    );
  });

  it.each(MODES.flatMap((mode) => [400, 401, 403, 404, 500, 503].map((status) => ({ mode, status }))))(
    '$mode does not retry HTTP $status',
    async ({ mode, status }) => {
      const response = new Response('Refused', { status });
      const cancel = vi.spyOn(response.body!, 'cancel');
      fetchMock.mockResolvedValueOnce(response);
      await expect(invoke(mode)).rejects.toMatchObject({ failure: mode === 'search' && [401, 403].includes(status) ? 'unauthorized' : 'error' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(cancel).toHaveBeenCalledTimes(1);
    },
  );

  it.each(MODES)('%s stops waiting immediately on abort and sends no further request', async (mode) => {
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    fetchMock.mockResolvedValueOnce(throttled());
    const outcome = expect(invoke(mode)).rejects.toMatchObject({ failure: 'throttled' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new DOMException('Cancelled', 'AbortError'));
    await outcome;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(MODES)('%s does not fetch when already aborted', async (mode) => {
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    controller.abort(new DOMException('Timed out', 'TimeoutError'));
    await expect(invoke(mode)).rejects.toMatchObject({ failure: 'timeout' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the NZB deadline across waits and an in-flight retry', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), ms);
      return controller.signal;
    });
    fetchMock
      .mockResolvedValueOnce(throttled('600'))
      .mockResolvedValueOnce(throttled('600'))
      .mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) =>
            init!.signal!.addEventListener('abort', () => reject(new DOMException('Timed out', 'TimeoutError')), { once: true }),
          ),
      );
    const outcome = expect(invoke('nzb')).rejects.toBeInstanceOf(IndexerRetryExhaustedException);
    await vi.advanceTimersByTimeAsync(24_999);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
    expect(Date.now() - NOW.getTime()).toBe(25_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('removes the abort listener after a completed wait', async () => {
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    fetchMock.mockResolvedValueOnce(throttled()).mockResolvedValueOnce(success('search'));
    const outcome = expect(invoke('search')).resolves.toEqual(expected('search'));
    await vi.advanceTimersByTimeAsync(5000);
    await outcome;
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]![1]);
  });

  it('still rejects a private redirect after a rate-limit retry', async () => {
    fetchMock
      .mockResolvedValueOnce(throttled('0'))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }));
    const outcome = expect(invoke('nzb')).rejects.toMatchObject({ failure: 'error' });
    await vi.runAllTimersAsync();
    await outcome;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a successful HTTP response containing invalid NZB data', async () => {
    fetchMock.mockResolvedValueOnce(throttled('0')).mockResolvedValueOnce(new Response('<html>Login</html>'));
    const outcome = expect(invoke('nzb')).rejects.toMatchObject({ failure: 'error', message: expect.stringContaining('not a valid NZB') });
    await vi.runAllTimersAsync();
    await outcome;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
