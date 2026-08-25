import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CoverSweepStore, MAX_SWEEP_ENTRIES, SWEEP_TTL_MS } from './cover-sweep.store';

describe('CoverSweepStore', () => {
  let store: CoverSweepStore;

  beforeEach(() => {
    store = new CoverSweepStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tracks a running sweep and completes it', () => {
    const record = store.start(1, [10, 11]);
    expect(store.isRunning(1)).toBe(true);
    expect(record.status).toBe('running');

    store.complete(1);
    expect(store.isRunning(1)).toBe(false);
    expect(store.get(1)?.status).toBe('completed');
  });

  it('records a failure with its error code', () => {
    store.start(1, []);
    store.fail(1, 'cover_sweep_failed');
    expect(store.get(1)).toMatchObject({ status: 'failed', errorCode: 'cover_sweep_failed' });
  });

  it('expires a finished sweep after the retention window', () => {
    vi.useFakeTimers();
    store.start(1, []);
    store.complete(1);

    vi.advanceTimersByTime(SWEEP_TTL_MS + 1);
    expect(store.get(1)).toBeUndefined();
  });

  it('keeps a running sweep alive past the retention window', () => {
    vi.useFakeTimers();
    store.start(1, []);

    vi.advanceTimersByTime(SWEEP_TTL_MS + 1);
    expect(store.get(1)?.status).toBe('running');
  });

  it('counts every broken cover but retains at most the cap', () => {
    const record = store.start(1, []);
    store.addBrokenCovers(
      record,
      Array.from({ length: MAX_SWEEP_ENTRIES }, (_, index) => index + 1),
    );
    store.addBrokenCovers(record, [MAX_SWEEP_ENTRIES + 1, MAX_SWEEP_ENTRIES + 2]);

    expect(record.brokenCoverCount).toBe(MAX_SWEEP_ENTRIES + 2);
    expect(record.brokenCoverBookIds).toHaveLength(MAX_SWEEP_ENTRIES);
    expect(record.truncated).toBe(true);
  });

  it('accumulates orphaned directory sizes', () => {
    const record = store.start(1, []);
    store.addOrphanedCoverDirs(record, [
      { bookId: 4, fileCount: 2, sizeBytes: 100 },
      { bookId: 5, fileCount: 1, sizeBytes: 50 },
    ]);

    expect(record.orphanedCoverDirCount).toBe(2);
    expect(record.orphanedBytes).toBe(150);
    expect(record.truncated).toBe(false);
  });

  it('evicts a finished sweep before a running one when at capacity', () => {
    for (let userId = 1; userId <= 8; userId += 1) {
      store.start(userId, []);
      if (userId !== 1) store.complete(userId);
    }
    store.start(9, []);

    expect(store.get(1)?.status).toBe('running');
    expect(store.get(2)).toBeUndefined();
  });
});
