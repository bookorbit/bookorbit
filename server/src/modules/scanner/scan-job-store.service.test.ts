import { ScanJobStore } from './scan-job-store.service';

function make() {
  return new ScanJobStore();
}

// ── isRunning / create / delete ───────────────────────────────────────────────

describe('lifecycle', () => {
  it('is not running before a job is created', () => {
    expect(make().isRunning(1)).toBe(false);
  });

  it('is running after create and not running after delete', () => {
    const store = make();
    store.create(100, 1, 50);
    expect(store.isRunning(1)).toBe(true);
    store.delete(1);
    expect(store.isRunning(1)).toBe(false);
  });

  it('create initialises all counters to zero and lastEmitPct to -1', () => {
    const entry = make().create(1, 10, 200);
    expect(entry).toMatchObject({ jobId: 1, libraryId: 10, total: 200, processed: 0, added: 0, updated: 0, missing: 0, lastEmitPct: -1 });
  });

  it('get returns the entry after create', () => {
    const store = make();
    const entry = store.create(5, 2, 0);
    expect(store.get(2)).toBe(entry);
  });

  it('get returns undefined for unknown libraryId', () => {
    expect(make().get(99)).toBeUndefined();
  });
});

// ── setTotal / increment ──────────────────────────────────────────────────────

describe('setTotal', () => {
  it('updates the total on an existing entry', () => {
    const store = make();
    store.create(1, 1, 0);
    store.setTotal(1, 500);
    expect(store.get(1)!.total).toBe(500);
  });

  it('does nothing for unknown libraryId', () => {
    expect(() => make().setTotal(99, 100)).not.toThrow();
  });
});

describe('increment', () => {
  it('accumulates processed, added, updated, missing independently', () => {
    const store = make();
    store.create(1, 1, 100);
    store.increment(1, { processed: 5 });
    store.increment(1, { added: 3, updated: 1 });
    store.increment(1, { missing: 2 });

    const entry = store.get(1)!;
    expect(entry.processed).toBe(5);
    expect(entry.added).toBe(3);
    expect(entry.updated).toBe(1);
    expect(entry.missing).toBe(2);
  });

  it('returns the entry after incrementing', () => {
    const store = make();
    store.create(1, 1, 10);
    const result = store.increment(1, { processed: 1 });
    expect(result).toBeDefined();
    expect(result!.processed).toBe(1);
  });

  it('returns undefined for unknown libraryId', () => {
    expect(make().increment(99, { processed: 1 })).toBeUndefined();
  });

  it('ignores undefined delta fields', () => {
    const store = make();
    store.create(1, 1, 10);
    store.increment(1, {}); // no-op
    expect(store.get(1)!.processed).toBe(0);
  });
});

// ── shouldEmit ────────────────────────────────────────────────────────────────

describe('shouldEmit', () => {
  it('emits when processed equals total (100%)', () => {
    const store = make();
    const entry = store.create(1, 1, 10);
    store.increment(1, { processed: 10 });
    expect(store.shouldEmit(entry)).toBe(true);
  });

  it('emits when percentage advances by at least 1 point', () => {
    const store = make();
    const entry = store.create(1, 1, 100);
    store.markEmitted(entry); // sets lastEmitPct to 0
    store.increment(1, { processed: 1 }); // 1%
    expect(store.shouldEmit(entry)).toBe(true);
  });

  it('does not emit when percentage has not moved', () => {
    const store = make();
    const entry = store.create(1, 1, 1000);
    store.markEmitted(entry); // lastEmitPct = 0, lastEmitMs = now
    store.increment(1, { processed: 1 }); // 0% (rounds down from 0.1%)
    // Neither pct nor time condition met (no fake timers, so ms check may vary —
    // we reset lastEmitMs to future to isolate the pct check)
    entry.lastEmitMs = Date.now() + 100_000;
    expect(store.shouldEmit(entry)).toBe(false);
  });

  it('emits when at least 1 second has elapsed since last emit', () => {
    const store = make();
    const entry = store.create(1, 1, 1000);
    entry.lastEmitMs = Date.now() - 1100; // last emitted > 1s ago
    expect(store.shouldEmit(entry)).toBe(true);
  });

  it('emits immediately (lastEmitMs = 0) because time threshold is always exceeded', () => {
    const store = make();
    const entry = store.create(1, 1, 10);
    // lastEmitMs starts at 0, so Date.now() - 0 is always >= 1000
    expect(store.shouldEmit(entry)).toBe(true);
  });
});

// ── markEmitted ───────────────────────────────────────────────────────────────

describe('markEmitted', () => {
  it('updates lastEmitMs to approximately now', () => {
    const before = Date.now();
    const store = make();
    const entry = store.create(1, 1, 100);
    store.markEmitted(entry);
    expect(entry.lastEmitMs).toBeGreaterThanOrEqual(before);
  });

  it('updates lastEmitPct based on current progress', () => {
    const store = make();
    const entry = store.create(1, 1, 100);
    store.increment(1, { processed: 42 });
    store.markEmitted(entry);
    expect(entry.lastEmitPct).toBe(42);
  });

  it('sets lastEmitPct to 0 when total is 0', () => {
    const store = make();
    const entry = store.create(1, 1, 0);
    store.markEmitted(entry);
    expect(entry.lastEmitPct).toBe(0);
  });
});
