import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import * as fetchWithThrottleModule from '../../fetch-with-throttle';
import { ProviderThrottleError } from '../../provider-throttle.error';
import { ComicVineClient } from './comicvine.client';

vi.mock('../../fetch-with-throttle', () => ({
  fetchWithThrottle: vi.fn(),
}));

const HOUR_MS = 3_600_000;

function makeOkResponse(results: unknown, isArray = true): Response {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        status_code: 1,
        error: 'OK',
        results: isArray ? results : results,
      }),
  } as Response;
}

function makeErrorResponse(status: number): Response {
  return { ok: false, status } as Response;
}

function make420Response(): Response {
  return { ok: false, status: 420 } as Response;
}

describe('ComicVineClient', () => {
  let client: ComicVineClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T10:00:00.000Z'));
    client = new ComicVineClient();
    mockFetch = vi.mocked(fetchWithThrottleModule.fetchWithThrottle);
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // RateLimiter / velocity guard
  // ---------------------------------------------------------------------------

  describe('velocity guard', () => {
    it('allows the first request immediately without delay', async () => {
      mockFetch.mockResolvedValue(makeOkResponse([]));
      const before = Date.now();
      const p = client.searchVolumes('Batman', 'key');
      await vi.runAllTimersAsync();
      await p;
      expect(Date.now() - before).toBe(0);
    });

    it('spaces consecutive requests 1 second apart', async () => {
      mockFetch.mockResolvedValue(makeOkResponse([]));

      // Start and fully settle the first request so nextAllowedTime is set
      const p1 = client.searchVolumes('Batman', 'key');
      await vi.runAllTimersAsync();
      await p1;
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second request should wait 1 second before firing
      const p2 = client.searchIssues('Batman', 'key');
      await vi.advanceTimersByTimeAsync(999);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      await p2;
    });
  });

  // ---------------------------------------------------------------------------
  // windowResetMs
  // ---------------------------------------------------------------------------

  describe('windowResetMs', () => {
    it('returns 0 when no requests have been made', () => {
      expect(client.windowResetMs()).toBe(0);
    });

    it('returns time until oldest request exits the 1-hour window', async () => {
      mockFetch.mockResolvedValue(makeOkResponse([]));
      const p = client.searchVolumes('Batman', 'key');
      await vi.runAllTimersAsync();
      await p;

      // Oldest request was at t=0; window resets at t+1h
      expect(client.windowResetMs()).toBe(HOUR_MS);
    });

    it('decreases as time passes', async () => {
      mockFetch.mockResolvedValue(makeOkResponse([]));
      const p = client.searchVolumes('Batman', 'key');
      await vi.runAllTimersAsync();
      await p;

      vi.advanceTimersByTime(30 * 60 * 1000); // 30 minutes pass
      expect(client.windowResetMs()).toBe(30 * 60 * 1000);
    });

    it('returns 0 after the window has fully elapsed', async () => {
      mockFetch.mockResolvedValue(makeOkResponse([]));
      const p = client.searchVolumes('Batman', 'key');
      await vi.runAllTimersAsync();
      await p;

      vi.advanceTimersByTime(HOUR_MS + 1);
      expect(client.windowResetMs()).toBe(0);
    });

    it('reflects the oldest in-window timestamp when multiple requests exist', async () => {
      mockFetch.mockResolvedValue(makeOkResponse([]));

      // Two requests 10 minutes apart
      const p1 = client.searchVolumes('Batman', 'key');
      await vi.runAllTimersAsync();
      await p1;

      vi.advanceTimersByTime(10 * 60 * 1000);

      const p2 = client.searchIssues('Batman', 'key');
      await vi.runAllTimersAsync();
      await p2;

      // Oldest is the first one — window resets 1h after that
      expect(client.windowResetMs()).toBe(50 * 60 * 1000);
    });

    it('evicts expired timestamps and returns 0 when all have exited the window', async () => {
      mockFetch.mockResolvedValue(makeOkResponse([]));

      const p = client.searchVolumes('Batman', 'key');
      await vi.runAllTimersAsync();
      await p;

      vi.advanceTimersByTime(HOUR_MS + 1000);
      expect(client.windowResetMs()).toBe(0);
    });

    it('prunes expired timestamps during throttle to avoid unbounded growth', async () => {
      mockFetch.mockResolvedValue(makeOkResponse([]));

      const p1 = client.searchVolumes('Batman', 'key');
      await vi.runAllTimersAsync();
      await p1;

      vi.advanceTimersByTime(HOUR_MS + 1);

      const p2 = client.searchIssues('Batman', 'key');
      await vi.runAllTimersAsync();
      await p2;

      const internalLimiter = (client as unknown as { rateLimiter: { timestamps: number[] } }).rateLimiter;
      expect(internalLimiter.timestamps).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // searchVolumes
  // ---------------------------------------------------------------------------

  describe('searchVolumes', () => {
    it('returns mapped volumes on success', async () => {
      const volumes = [{ id: 1, name: 'Batman' }];
      mockFetch.mockResolvedValue(makeOkResponse(volumes));

      const p = client.searchVolumes('Batman', 'key');
      await vi.runAllTimersAsync();
      const result = await p;

      expect(result).toEqual(volumes);
    });

    it('returns cached result without making a new request', async () => {
      const volumes = [{ id: 1, name: 'Batman' }];
      mockFetch.mockResolvedValue(makeOkResponse(volumes));

      const p1 = client.searchVolumes('batman', 'key');
      await vi.runAllTimersAsync();
      await p1;

      const callCount = mockFetch.mock.calls.length;

      const p2 = client.searchVolumes('Batman', 'key'); // different casing
      await vi.runAllTimersAsync();
      const result = await p2;

      expect(mockFetch).toHaveBeenCalledTimes(callCount); // no new request
      expect(result).toEqual(volumes);
    });

    it('bypasses cache after TTL expires', async () => {
      mockFetch.mockResolvedValue(makeOkResponse([{ id: 1, name: 'Batman' }]));

      const p1 = client.searchVolumes('Batman', 'key');
      await vi.runAllTimersAsync();
      await p1;

      vi.advanceTimersByTime(10 * 60 * 1000 + 1); // past 10-min TTL

      mockFetch.mockResolvedValue(makeOkResponse([{ id: 2, name: 'Batman Vol 2' }]));
      const p2 = client.searchVolumes('Batman', 'key');
      await vi.runAllTimersAsync();
      const result = await p2;

      expect(result).toEqual([{ id: 2, name: 'Batman Vol 2' }]);
    });

    it('returns empty array on non-ok response', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(500));

      const p = client.searchVolumes('Batman', 'key');
      await vi.runAllTimersAsync();

      expect(await p).toEqual([]);
    });

    it('returns empty array when API status_code is not 1', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status_code: 100, error: 'Invalid API Key', results: null }),
      } as Response);

      const p = client.searchVolumes('Batman', 'key');
      await vi.runAllTimersAsync();

      expect(await p).toEqual([]);
    });

    it('throws ProviderThrottleError on 420', async () => {
      mockFetch.mockResolvedValue(make420Response());

      const p = client.searchVolumes('Batman', 'key');
      const assertion = expect(p).rejects.toThrow(ProviderThrottleError);
      await vi.runAllTimersAsync();
      await assertion;
    });

    it('returns empty array on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const p = client.searchVolumes('Batman', 'key');
      await vi.runAllTimersAsync();

      expect(await p).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // searchIssuesInVolume
  // ---------------------------------------------------------------------------

  describe('searchIssuesInVolume', () => {
    it('returns issues on success', async () => {
      const issues = [{ id: 10, issue_number: '1' }];
      mockFetch.mockResolvedValue(makeOkResponse(issues));

      const p = client.searchIssuesInVolume(1, '1', 'key');
      await vi.runAllTimersAsync();

      expect(await p).toEqual(issues);
    });

    it('returns empty array on non-ok response', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(503));

      const p = client.searchIssuesInVolume(1, '1', 'key');
      await vi.runAllTimersAsync();

      expect(await p).toEqual([]);
    });

    it('throws ProviderThrottleError on 420', async () => {
      mockFetch.mockResolvedValue(make420Response());

      const p = client.searchIssuesInVolume(1, '1', 'key');
      const assertion = expect(p).rejects.toThrow(ProviderThrottleError);
      await vi.runAllTimersAsync();
      await assertion;
    });
  });

  // ---------------------------------------------------------------------------
  // searchIssues
  // ---------------------------------------------------------------------------

  describe('searchIssues', () => {
    it('returns issues on success', async () => {
      const issues = [{ id: 20, name: 'Batman #1' }];
      mockFetch.mockResolvedValue(makeOkResponse(issues));

      const p = client.searchIssues('Batman #1', 'key');
      await vi.runAllTimersAsync();

      expect(await p).toEqual(issues);
    });

    it('throws ProviderThrottleError on 420', async () => {
      mockFetch.mockResolvedValue(make420Response());

      const p = client.searchIssues('Batman', 'key');
      const assertion = expect(p).rejects.toThrow(ProviderThrottleError);
      await vi.runAllTimersAsync();
      await assertion;
    });
  });

  // ---------------------------------------------------------------------------
  // getIssueById
  // ---------------------------------------------------------------------------

  describe('getIssueById', () => {
    it('returns the issue on success', async () => {
      const issue = { id: 999, name: 'Batman #1' };
      mockFetch.mockResolvedValue(makeOkResponse(issue, false));

      const p = client.getIssueById('999', 'key');
      await vi.runAllTimersAsync();

      expect(await p).toEqual(issue);
    });

    it('returns null on non-ok response', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(404));

      const p = client.getIssueById('999', 'key');
      await vi.runAllTimersAsync();

      expect(await p).toBeNull();
    });

    it('throws ProviderThrottleError on 420', async () => {
      mockFetch.mockResolvedValue(make420Response());

      const p = client.getIssueById('999', 'key');
      const assertion = expect(p).rejects.toThrow(ProviderThrottleError);
      await vi.runAllTimersAsync();
      await assertion;
    });

    it('returns null on network error', async () => {
      mockFetch.mockRejectedValue(new Error('timeout'));

      const p = client.getIssueById('999', 'key');
      await vi.runAllTimersAsync();

      expect(await p).toBeNull();
    });
  });
});
