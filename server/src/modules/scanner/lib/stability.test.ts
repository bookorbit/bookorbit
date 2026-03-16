vi.mock('fs/promises', () => ({ stat: vi.fn() }));

import { stat } from 'fs/promises';
import type { MockedFunction } from 'vitest';
import { waitForStability } from './stability';

const mockStat = stat as MockedFunction<typeof stat>;

// Constants mirrored from stability.ts to keep assertions meaningful
const POLL_INTERVAL_MS = 3_000;
const STABLE_DURATION_MS = 10_000;
const MAX_WAIT_MS = 60_000;
const RECENTLY_MODIFIED_THRESHOLD_MS = 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── FAST PATHS ────────────────────────────────────────────────────────────────

describe('fast paths (no polling)', () => {
  it('returns immediately for files whose mtime is older than the threshold', async () => {
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - RECENTLY_MODIFIED_THRESHOLD_MS - 1 } as any);

    await waitForStability('/path/old-book.epub');

    expect(mockStat).toHaveBeenCalledTimes(1);
  });

  it('returns immediately when the file does not exist', async () => {
    mockStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    await waitForStability('/path/gone.epub');

    expect(mockStat).toHaveBeenCalledTimes(1);
  });
});

// ── POLLING UNTIL STABLE ──────────────────────────────────────────────────────

describe('polling until stable', () => {
  it('returns once mtime has not changed for STABLE_DURATION_MS', async () => {
    const recentMtime = Date.now() - 1_000; // recently modified
    // Initial stat check
    mockStat.mockResolvedValueOnce({ mtimeMs: recentMtime } as any);
    // All subsequent polls return the same mtime (stable)
    mockStat.mockResolvedValue({ mtimeMs: recentMtime } as any);

    const promise = waitForStability('/path/book.epub');

    // Drain the initial stat and first loop iteration, then advance well past STABLE_DURATION_MS
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4 + STABLE_DURATION_MS);
    await promise;

    // Should have polled at least a few times before returning
    expect(mockStat.mock.calls.length).toBeGreaterThan(2);
  });

  it('resets the stable timer when mtime changes mid-poll', async () => {
    const recentMtime = Date.now() - 1_000;
    let callCount = 0;
    mockStat.mockImplementation(() => {
      callCount++;
      // Mtime changes on the 2nd poll call (inside the loop), then stays stable
      return Promise.resolve({ mtimeMs: callCount < 3 ? recentMtime + callCount * 100 : recentMtime + 200 } as any);
    });

    const promise = waitForStability('/path/book.epub');

    // Advance far enough for the file to stabilise after the change
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 6 + STABLE_DURATION_MS);
    await promise;

    // More iterations were needed because the timer reset after the mtime change
    expect(callCount).toBeGreaterThan(4);
  });
});

// ── DEADLINE HIT ──────────────────────────────────────────────────────────────

describe('deadline exceeded', () => {
  it('returns without throwing when mtime keeps changing past the deadline', async () => {
    let t = Date.now() - 1_000;
    mockStat.mockImplementation(() => {
      t += 100;
      return Promise.resolve({ mtimeMs: t } as any);
    });

    const promise = waitForStability('/path/active-download.epub');

    // Advance past the full deadline
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS + POLL_INTERVAL_MS * 2);
    await expect(promise).resolves.toBeUndefined();
  });
});

// ── FILE DISAPPEARS DURING POLLING ────────────────────────────────────────────

describe('file disappears mid-poll', () => {
  it('returns silently when stat throws ENOENT inside the polling loop', async () => {
    const recentMtime = Date.now() - 1_000;
    mockStat
      .mockResolvedValueOnce({ mtimeMs: recentMtime } as any) // initial check
      .mockResolvedValueOnce({ mtimeMs: recentMtime } as any) // first poll
      .mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })); // disappears

    const promise = waitForStability('/path/book.epub');

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    await expect(promise).resolves.toBeUndefined();
  });
});
