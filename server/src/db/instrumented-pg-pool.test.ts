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
});
