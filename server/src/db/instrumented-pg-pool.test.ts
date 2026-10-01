import { EventEmitter } from 'node:events';

import { Logger } from '@nestjs/common';
import { Pool, type ClientBase, type PoolClient } from 'pg';

import { InstrumentedPgPool } from './instrumented-pg-pool';

class FakePoolClient extends EventEmitter {
  release!: (error?: Error) => void;
  ended = false;
  _ending = false;
  _queryable = true;

  connect(callback: (error?: Error) => void): void {
    callback();
  }

  end(callback?: () => void): void {
    this.ended = true;
    callback?.();
  }
}

const fakeClientConstructor = FakePoolClient as unknown as new () => ClientBase;

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

  it('handles an idle client disconnect without throwing and removes the failed client', async () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const pool = new InstrumentedPgPool({ max: 1, Client: fakeClientConstructor });
    const client = await pool.connect();
    client.release();

    expect(pool.idleCount).toBe(1);
    expect(() => client.emit('error', new Error('idle connection lost'))).not.toThrow();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[db\.connection\] \[fail\] clientState=idle durationMs=\d+ totalCount=0 idleCount=0 waitingCount=0 errorClass=Error error="idle connection lost" - database connection lost$/,
      ),
    );
    expect(pool.totalCount).toBe(0);
    expect((client as unknown as FakePoolClient).ended).toBe(true);

    const replacement = await pool.connect();
    expect(replacement).not.toBe(client);
    replacement.release();
    await pool.end();
  });

  it('handles a checked-out client disconnect without throwing or double logging', async () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const pool = new InstrumentedPgPool({ max: 1, Client: fakeClientConstructor });
    const client = await pool.connect();
    const error = new Error('checked-out connection lost');

    expect(pool.idleCount).toBe(0);
    expect(() => client.emit('error', error)).not.toThrow();
    expect(() => client.emit('error', new Error('follow-up socket error'))).not.toThrow();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[db\.connection\] \[fail\] clientState=checked-out durationMs=\d+ totalCount=1 idleCount=0 waitingCount=0 errorClass=Error error="checked-out connection lost" - database connection lost$/,
      ),
    );

    client.release(error);
    expect(pool.totalCount).toBe(0);

    const replacement = await pool.connect();
    expect(replacement).not.toBe(client);
    replacement.release();
    await pool.end();
  });

  it('sanitizes connection errors before logging them', async () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const pool = new InstrumentedPgPool({ max: 1, Client: fakeClientConstructor });
    const client = await pool.connect();

    client.emit('error', new Error('socket closed\nfor "maintenance"'));

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('error="socket closed for \\"maintenance\\""'));

    client.release(new Error('connection failed'));
    await pool.end();
  });
});
