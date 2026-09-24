import { Logger } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';

import { InstrumentedPgPool } from './instrumented-pg-pool';

describe('InstrumentedPgPool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs acquisition time when a query starts with the pool saturated', async () => {
    const client = {} as PoolClient;
    vi.spyOn(Pool.prototype, 'connect').mockResolvedValue(client);
    const debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const pool = new InstrumentedPgPool({ max: 1 });
    Object.defineProperty(pool, 'totalCount', { value: 1 });
    Object.defineProperty(pool, 'idleCount', { value: 0 });
    Object.defineProperty(pool, 'waitingCount', { value: 0 });

    await expect(pool.connect()).resolves.toBe(client);

    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('[db.pool_acquire] [end] acquisitionKind=queued durationMs='));
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('acquisitionKind=queued'));
  });

  it('logs acquisition time when the pool opens a new connection', async () => {
    const client = {} as PoolClient;
    vi.spyOn(Pool.prototype, 'connect').mockResolvedValue(client);
    const debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const pool = new InstrumentedPgPool({ max: 2 });

    await expect(pool.connect()).resolves.toBe(client);

    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('acquisitionKind=new'));
  });

  it('does not log acquisitions from an idle connection', async () => {
    vi.spyOn(Pool.prototype, 'connect').mockResolvedValue({} as PoolClient);
    const debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const pool = new InstrumentedPgPool({ max: 2 });
    Object.defineProperty(pool, 'totalCount', { value: 1 });
    Object.defineProperty(pool, 'idleCount', { value: 1 });

    await pool.connect();

    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('logs failures while acquiring an idle connection', async () => {
    const error = new Error('connection closed');
    vi.spyOn(Pool.prototype, 'connect').mockRejectedValue(error);
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const pool = new InstrumentedPgPool({ max: 2 });
    Object.defineProperty(pool, 'totalCount', { value: 1 });
    Object.defineProperty(pool, 'idleCount', { value: 1 });

    await expect(pool.connect()).rejects.toThrow(error);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[db.pool_acquire] [fail] acquisitionKind=idle'));
  });

  // The bug these lines were hiding.
  //
  // A real incident logged `idleCount=9 waitingCount=0` on every failure, which
  // reads as nine connections sitting unused while acquisition timed out.
  // Impossible, and it sent the investigation looking for an accounting bug in
  // the pool. There was none. The counters were simply read when the line was
  // written, five seconds after the acquire began, by which point the requests
  // holding the pool had finished and released.
  it('reports the pool as it was when the acquire began, not when the failure was logged', async () => {
    const failure = new Error('timeout exceeded when trying to connect');
    vi.spyOn(Pool.prototype, 'connect').mockRejectedValue(failure);
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const pool = new InstrumentedPgPool({ max: 20 });
    // Saturated: 19 of 20 held, nothing idle, eight requests queued behind them.
    let counts = { totalCount: 19, idleCount: 0, waitingCount: 8 };
    Object.defineProperty(pool, 'totalCount', { get: () => counts.totalCount });
    Object.defineProperty(pool, 'idleCount', { get: () => counts.idleCount });
    Object.defineProperty(pool, 'waitingCount', { get: () => counts.waitingCount });

    // `connect` samples the pool synchronously before awaiting anything, so
    // this models the real sequence exactly: the expensive requests finish and
    // release while the doomed acquire is still counting down its five seconds.
    const acquiring = pool.connect();
    counts = { totalCount: 17, idleCount: 9, waitingCount: 0 };

    await expect(acquiring).rejects.toBe(failure);

    const line = warnSpy.mock.calls[0]?.[0] as string;
    // The state that explains the failure.
    expect(line).toContain('startTotal=19 startIdle=0 startWaiting=8');
    // Kept, because the recovery is worth seeing, just not on its own.
    expect(line).toContain('totalCount=17 idleCount=9 waitingCount=0');
  });

  // The other direction, and the reason `acquisitionKind` is documented rather
  // than fixed: it is sampled before `super.connect()` and nothing reserves the
  // idle connection it saw. A concurrent acquire can take it first, so a
  // failure can be labelled `acquisitionKind=idle` having never had one.
  // Without the start counters that label is unfalsifiable from the log; with
  // them, `startIdle=1 idleCount=0` shows plainly what happened.
  it('keeps the stale acquisitionKind but shows the idle connection was taken', async () => {
    const failure = new Error('timeout exceeded when trying to connect');
    vi.spyOn(Pool.prototype, 'connect').mockRejectedValue(failure);
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const pool = new InstrumentedPgPool({ max: 20 });
    // One connection idle at the instant we classify, so this acquire is 'idle'.
    let counts = { totalCount: 10, idleCount: 1, waitingCount: 0 };
    Object.defineProperty(pool, 'totalCount', { get: () => counts.totalCount });
    Object.defineProperty(pool, 'idleCount', { get: () => counts.idleCount });
    Object.defineProperty(pool, 'waitingCount', { get: () => counts.waitingCount });

    const acquiring = pool.connect();
    // A concurrent acquire takes that connection and the pool saturates behind it.
    counts = { totalCount: 20, idleCount: 0, waitingCount: 3 };

    await expect(acquiring).rejects.toBe(failure);

    const line = warnSpy.mock.calls[0]?.[0] as string;
    // Stale by construction: it was idle when we looked, gone when we asked.
    expect(line).toContain('acquisitionKind=idle');
    expect(line).toContain('startTotal=10 startIdle=1 startWaiting=0');
    expect(line).toContain('totalCount=20 idleCount=0 waitingCount=3');
  });
});
